import { createServer } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import { createServer as createSocketServer } from "node:net";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { userPathEntriesUnder } from "../__fixtures__/user-path.js";
import { installedProxyWorld, providerEvents, PROVIDERS, readyRecord, setHostSetting, startSession } from "../__fixtures__/proxy-world.js";
import type { ProxyWorld, RunningSession } from "../__fixtures__/proxy-world.js";

const MODEL_MAP = {
  plain: [{ provider: "provider-a", model: "provider-a-ok" }],
  limited: [{ provider: "provider-a", model: "provider-a-429" }, { provider: "provider-b", model: "provider-b-ok" }],
  exhausted: [{ provider: "provider-a", model: "provider-a-429" }, { provider: "provider-b", model: "provider-b-429" }],
  firstfail: [{ provider: "provider-a", model: "provider-a-first-fails" }, { provider: "provider-b", model: "provider-b-stream" }],
  thirdfail: [{ provider: "provider-a", model: "provider-a-third-fails" }, { provider: "provider-b", model: "provider-b-stream" }],
  hanging: [{ provider: "provider-a", model: "provider-a-hangs" }, { provider: "provider-b", model: "provider-b-ok" }],
  default: [{ provider: "provider-a", model: "provider-a-ok" }],
};

interface Received {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

let world: ProxyWorld;
let session: RunningSession;

function url(path: string): string {
  return `http://127.0.0.1:${world.port}${path}`;
}

function post(model: string, stream = false, signal?: AbortSignal): Promise<Response> {
  return fetch(url("/v1/messages"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, text: "hi", stream }), signal });
}

function handledModels(): string[] {
  return providerEvents(world).filter((entry) => entry.event === "handled").map((entry) => entry.model);
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 10000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function eventsIn(body: string): string[] {
  return body.split("\n").filter((line) => line.startsWith("event: ")).map((line) => line.slice("event: ".length));
}

function loopbackUpstream(received: Received[]): Promise<{ server: Server; address: string }> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers, body: Buffer.concat(chunks) });
      response.writeHead(201, { "content-type": "text/plain", "x-upstream": "yes" });
      response.end("from upstream");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    resolve({ server, address: `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}` });
  }));
}

function closed(server: { close(callback: () => void): unknown }): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

beforeAll(async () => {
  world = await installedProxyWorld();
  setHostSetting(world, "routing.modelMap", MODEL_MAP);
  session = await startSession(world);
}, 300000);

afterAll(async () => {
  await session?.stop();
  expect(userPathEntriesUnder(world.base)).toEqual([]);
  rmSync(world.base, { recursive: true, force: true });
});

describe("the session host serving an enabled front door", () => {
  it("publishes the environment routing.environment answers, its base url on the proxy port", () => {
    const record = readyRecord(world);
    expect(record).toMatchObject({ pid: session.process.pid });
    expect((record?.environment as Record<string, string>).ANTHROPIC_BASE_URL).toBe(`http://127.0.0.1:${world.port}`);
  });

  it("answers ok on /health", async () => {
    const response = await fetch(url("/health"));
    expect(await response.text()).toBe("ok");
  });

  it("lists every model the providers answered on /v1/models", async () => {
    const listed = (await (await fetch(url("/v1/models"))).json()) as { data: Array<{ id: string; max_input_tokens: number }> };
    expect(listed.data.map((model) => model.id)).toEqual(expect.arrayContaining(["provider-a-ok", "provider-b-stream"]));
    expect(listed.data).toHaveLength(12);
    expect(listed.data[0]?.max_input_tokens).toBe(1000);
  });

  it("round-trips a provider's 2xx answer through the front door", async () => {
    const response = await post("plain");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ model: "provider-a-ok", text: "served provider-a-ok: hi" });
  });

  it("falls over to the next chain entry when the first is rate limited", async () => {
    const response = await post("limited");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ text: "served provider-b-ok: hi" });
    expect(handledModels()).toEqual(expect.arrayContaining(["provider-a-429", "provider-b-ok"]));
  });

  it("answers the front door's rate-limit reply when every entry is rate limited", async () => {
    const response = await post("exhausted");
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ limited: true, retryAfter: "30" });
  });

  it("falls over when a stream fails on its first event, before any byte is written", async () => {
    const response = await post("firstfail", true);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await response.text();
    expect(eventsIn(body)).toEqual(["message_start", "content_block_start", "text_delta", "content_block_stop", "message_delta", "message_stop"]);
    expect(body).toContain("served provider-b-stream: hi");
  });

  it("ends a stream that fails on its third event with an error event, never falling over", async () => {
    const before = providerEvents(world).length;
    const response = await post("thirdfail", true);
    expect(response.status).toBe(200);
    expect(eventsIn(await response.text())).toEqual(["message_start", "content_block_start", "error"]);
    expect(providerEvents(world).slice(before).map((entry) => entry.model)).toEqual(["provider-a-third-fails"]);
  });

  it("aborts the provider's signal when the client disconnects, and falls over to nothing", async () => {
    const before = providerEvents(world).length;
    const client = new AbortController();
    const answered = post("hanging", false, client.signal).catch((error: unknown) => error);
    await until(() => providerEvents(world).slice(before).some((entry) => entry.event === "handled"), "the provider to be called");
    client.abort();
    await answered;
    await until(() => providerEvents(world).slice(before).some((entry) => entry.event === "aborted"), "the provider's signal to abort");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(providerEvents(world).slice(before)).toEqual([
      { provider: "provider-a", model: "provider-a-hangs", event: "handled" },
      { provider: "provider-a", model: "provider-a-hangs", event: "aborted" },
    ]);
  });
});

describe("the session host with no provider enabled", () => {
  it("passes a request through to the profile's upstream byte for byte, its authorization unchanged", async () => {
    await session.stop();
    for (const id of PROVIDERS) setHostSetting(world, `plugins.${id}.enabled`, false, "portable");
    const received: Received[] = [];
    const upstream = await loopbackUpstream(received);
    session = await startSession(world, { FIXTURE_UPSTREAM: upstream.address });
    try {
      const body = Buffer.from('{"model":"plain","text":"h\\u00e9 é"}', "utf8");
      const response = await fetch(url("/v1/messages?beta=true"), { method: "POST", headers: { authorization: "Bearer user-own-token", "content-type": "application/json", "x-extra": "1" }, body });
      expect(response.status).toBe(201);
      expect(response.headers.get("x-upstream")).toBe("yes");
      expect(await response.text()).toBe("from upstream");
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ method: "POST", url: "/v1/messages?beta=true" });
      expect(received[0]?.headers.authorization).toBe("Bearer user-own-token");
      expect(received[0]?.headers["x-extra"]).toBe("1");
      expect(received[0]?.body.equals(body)).toBe(true);
      expect(readyRecord(world)?.environment).toEqual({ ANTHROPIC_BASE_URL: `http://127.0.0.1:${world.port}` });
    } finally {
      await closed(upstream.server);
    }
  });

  it("publishes a refusal naming the port and proxy.port when the port is already taken", async () => {
    await session.stop();
    const squatter = createSocketServer();
    await new Promise<void>((resolve) => squatter.listen(world.port, "127.0.0.1", () => resolve()));
    try {
      session = await startSession(world);
      const record = readyRecord(world);
      expect(record).toMatchObject({ pid: session.process.pid });
      expect(record?.environment).toBeUndefined();
      expect(String(record?.refused)).toContain(String(world.port));
      expect(String(record?.fix)).toContain("proxy.port");
    } finally {
      await closed(squatter);
    }
  });
});
