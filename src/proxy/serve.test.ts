import { readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer as createSocketServer } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { userPathEntriesUnder } from "../__fixtures__/user-path.js";
import { FRONT_DOOR, installedProxyWorld, providerEvents, PROVIDERS, readyRecord, setHostSetting, startSession } from "../__fixtures__/proxy-world.js";
import type { ProxyWorld, RunningSession } from "../__fixtures__/proxy-world.js";

const MODEL_MAP = {
  plain: [{ provider: "provider-a", model: "provider-a-ok" }],
  limited: [{ provider: "provider-a", model: "provider-a-429" }, { provider: "provider-b", model: "provider-b-ok" }],
  exhausted: [{ provider: "provider-a", model: "provider-a-429" }, { provider: "provider-b", model: "provider-b-429" }],
  waiting: [{ provider: "provider-a", model: "provider-a-429-milliseconds" }, { provider: "provider-b", model: "provider-b-429" }],
  failing: [{ provider: "provider-a", model: "provider-a-400" }, { provider: "provider-b", model: "provider-b-ok" }],
  firstfail: [{ provider: "provider-a", model: "provider-a-first-fails" }, { provider: "provider-b", model: "provider-b-stream" }],
  thirdfail: [{ provider: "provider-a", model: "provider-a-third-fails" }, { provider: "provider-b", model: "provider-b-stream" }],
  hanging: [{ provider: "provider-a", model: "provider-a-hangs" }, { provider: "provider-b", model: "provider-b-ok" }],
  stalling: [{ provider: "provider-a", model: "provider-a-stalls" }, { provider: "provider-b", model: "provider-b-ok" }],
  fallbackfails: [{ provider: "provider-a", model: "provider-a-429" }, { provider: "provider-b", model: "provider-b-400" }],
  default: [{ provider: "provider-a", model: "provider-a-ok" }],
};
const RETRY_AFTER_MILLISECONDS = 60000;
const RETRY_AFTER_SECONDS_MILLISECONDS = 30000;
/** The session host reads its own clock, a process apart from the test's, so a reset is compared within a second. */
const CLOCK_TOLERANCE_MILLISECONDS = 1000;

interface Received {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** A loopback upstream: `/stream` holds its second chunk until released, `/hang` never answers, anything else answers at once. */
interface Upstream {
  server: Server;
  address: string;
  received: Received[];
  hangClosed: boolean;
  releaseStream(): void;
}

let world: ProxyWorld;
let session: RunningSession;
let upstream: Upstream;

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

function logFilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return logFilesUnder(path);
    return entry.name.endsWith(".log") ? [path] : [];
  });
}

function hostLog(): string {
  return logFilesUnder(world.base).filter((file) => file !== world.providerLog).map((file) => readFileSync(file, "utf8")).join("\n");
}

function answerUpstream(state: Upstream, request: IncomingMessage, response: ServerResponse, body: Buffer): void {
  state.received.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers, body });
  if (request.url === "/hang") {
    response.once("close", () => (state.hangClosed = true));
    return;
  }
  if (request.url === "/stream") {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write("first\n");
    state.releaseStream = () => response.end("second\n");
    return;
  }
  response.writeHead(201, { "content-type": "text/plain", "x-upstream": "yes" });
  response.end("from upstream");
}

function loopbackUpstream(): Promise<Upstream> {
  const state = { received: [], hangClosed: false, releaseStream: () => undefined } as unknown as Upstream;
  state.server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => answerUpstream(state, request, response, Buffer.concat(chunks)));
  });
  return new Promise((resolve) => state.server.listen(0, "127.0.0.1", () => {
    const address = state.server.address();
    state.address = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
    resolve(state);
  }));
}

function closed(server: { close(callback: () => void): unknown }): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function rawStatus(headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ hostname: "127.0.0.1", port: world.port, path: "/health", method: "GET", headers }, (incoming) => {
      incoming.resume();
      incoming.on("end", () => resolve(incoming.statusCode ?? 0));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

function startServing(environment: Record<string, string> = {}): Promise<RunningSession> {
  return startSession(world, { FIXTURE_UPSTREAM: upstream.address, ...environment });
}

beforeAll(async () => {
  world = await installedProxyWorld();
  setHostSetting(world, "routing.modelMap", MODEL_MAP);
  upstream = await loopbackUpstream();
  session = await startServing();
}, 300000);

afterAll(async () => {
  await session?.stop();
  await closed(upstream.server);
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

  it("refuses with 403 a request carrying an Origin, or naming a host other than its loopback address", async () => {
    expect(await rawStatus({ origin: "https://evil.example" })).toBe(403);
    expect(await rawStatus({ host: `evil.example:${world.port}` })).toBe(403);
    expect(await rawStatus({ host: `localhost:${world.port}` })).toBe(200);
    expect(await rawStatus({ host: `127.0.0.1:${world.port}` })).toBe(200);
  });

  it("lists every model the providers answered on /v1/models", async () => {
    const listed = (await (await fetch(url("/v1/models"))).json()) as { data: Array<{ id: string; max_input_tokens: number }> };
    expect(listed.data.map((model) => model.id)).toEqual(expect.arrayContaining(["provider-a-ok", "provider-b-stream"]));
    expect(listed.data).toHaveLength(18);
    expect(listed.data[0]?.max_input_tokens).toBe(1000);
  });

  it("round-trips a provider's 2xx answer through the front door", async () => {
    const response = await post("plain");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ model: "provider-a-ok", text: "served provider-a-ok: hi" });
  });

  it("falls over to the next chain entry when the first is rate limited, and says so in the host log", async () => {
    const response = await post("limited");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ text: "served provider-b-ok: hi" });
    expect(handledModels()).toEqual(expect.arrayContaining(["provider-a-429", "provider-b-ok"]));
    await until(() => hostLog().includes("provider-b-ok served limited in place of provider-a-429"), "the fallback to be logged");
    expect(hostLog()).toContain("provider-a-429 is rate limited, so the next chain entry serves limited");
  });

  it("answers the front door's rate-limit reply when every entry is rate limited, logging that none is left", async () => {
    const response = await post("exhausted");
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ limited: true, retryAfter: "30" });
    await until(() => hostLog().includes("provider-b-429 is rate limited, and no chain entry is left to serve exhausted"), "the exhaustion to be logged");
    expect(hostLog()).not.toContain("provider-b-429 is rate limited, so the next chain entry serves exhausted");
  });

  it("logs no fallback serving when the fallback entry answers a failure", async () => {
    const response = await post("fallbackfails");
    expect(response.status).toBe(400);
    await response.text();
    await until(() => hostLog().includes("provider-a-429 is rate limited, so the next chain entry serves fallbackfails"), "the fall-over to be logged");
    expect(hostLog()).not.toContain("provider-b-400 served fallbackfails");
  });

  it("hands the rate-limit reply the latest reset of every entry, reading retryAfterMilliseconds as a reset", async () => {
    const before = Date.now();
    const response = await post("waiting");
    const after = Date.now();
    expect(response.status).toBe(429);
    const reply = (await response.json()) as { resetAt: number; retryAfter: string };
    expect(reply.retryAfter).toBe("30");
    expect(reply.resetAt).toBeGreaterThanOrEqual(before + RETRY_AFTER_MILLISECONDS - CLOCK_TOLERANCE_MILLISECONDS);
    expect(reply.resetAt).toBeLessThanOrEqual(after + RETRY_AFTER_MILLISECONDS + CLOCK_TOLERANCE_MILLISECONDS);
    expect(reply.resetAt).toBeGreaterThan(after + RETRY_AFTER_SECONDS_MILLISECONDS);
  });

  it("answers a provider's failure without its framing, encoding or hop-by-hop headers", async () => {
    const response = await post("failing");
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("bad request");
    expect(response.headers.get("x-kept")).toBe("yes");
    for (const dropped of ["content-encoding", "x-hop", "proxy-authenticate"]) expect(response.headers.get(dropped), dropped).toBeNull();
    expect(response.headers.get("keep-alive")).not.toBe("timeout=77");
    expect(response.headers.get("content-length")).not.toBe("999");
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

  it("aborts the provider's signal when the client disconnects mid-stream, and calls nothing more", async () => {
    const before = providerEvents(world).length;
    const client = new AbortController();
    const response = await post("stalling", true, client.signal);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("message_start");
    client.abort();
    await until(() => providerEvents(world).slice(before).some((entry) => entry.event === "aborted"), "the provider's signal to abort");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(providerEvents(world).slice(before)).toEqual([
      { provider: "provider-a", model: "provider-a-stalls", event: "handled" },
      { provider: "provider-a", model: "provider-a-stalls", event: "aborted" },
    ]);
  });

  it("forwards undecoded what the front door answers a pass-through for, such as count_tokens", async () => {
    const before = upstream.received.length;
    const body = '{"model":"plain","messages":[]}';
    const response = await fetch(url("/v1/messages/count_tokens"), { method: "POST", headers: { authorization: "Bearer own", "content-type": "application/json" }, body });
    expect(response.status).toBe(201);
    expect(await response.text()).toBe("from upstream");
    const received = upstream.received.slice(before);
    expect(received.map((entry) => entry.url)).toEqual(["/v1/messages/count_tokens"]);
    expect(received[0]?.body.toString("utf8")).toBe(body);
    expect(received[0]?.headers.authorization).toBe("Bearer own");
  });

  it("relays a streaming upstream answer as it arrives, never buffering it", async () => {
    const response = await fetch(url("/stream"));
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("first\n");
    upstream.releaseStream();
    let rest = "";
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) rest += new TextDecoder().decode(chunk.value);
    expect(rest).toBe("second\n");
  });

  it("closes the upstream call when the client of a passed-through request disconnects", async () => {
    upstream.hangClosed = false;
    const client = new AbortController();
    const answered = fetch(url("/hang"), { signal: client.signal }).catch((error: unknown) => error);
    await until(() => upstream.received.some((entry) => entry.url === "/hang"), "the upstream to be called");
    client.abort();
    await answered;
    await until(() => upstream.hangClosed, "the upstream call to close");
  });
});

describe("the session host with no provider enabled", () => {
  it("passes a request through to the profile's upstream byte for byte, its authorization unchanged", async () => {
    await session.stop();
    for (const id of PROVIDERS) setHostSetting(world, `plugins.${id}.enabled`, false, "portable");
    session = await startServing();
    const before = upstream.received.length;
    const body = Buffer.from('{"model":"plain","text":"h\\u00e9 é"}', "utf8");
    const response = await fetch(url("/v1/messages?beta=true"), { method: "POST", headers: { authorization: "Bearer user-own-token", "content-type": "application/json", "x-extra": "1" }, body });
    expect(response.status).toBe(201);
    expect(response.headers.get("x-upstream")).toBe("yes");
    expect(await response.text()).toBe("from upstream");
    const received = upstream.received.slice(before);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ method: "POST", url: "/v1/messages?beta=true" });
    expect(received[0]?.headers.authorization).toBe("Bearer user-own-token");
    expect(received[0]?.headers["x-extra"]).toBe("1");
    expect(received[0]?.body.equals(body)).toBe(true);
    expect(readyRecord(world)?.environment).toEqual({ ANTHROPIC_BASE_URL: `http://127.0.0.1:${world.port}` });
  });

  it("publishes a refusal naming the port and proxy.port when the port is already taken", async () => {
    await session.stop();
    const squatter = createSocketServer();
    await new Promise<void>((resolve) => squatter.listen(world.port, "127.0.0.1", () => resolve()));
    try {
      session = await startServing();
      const record = readyRecord(world);
      expect(record).toMatchObject({ pid: session.process.pid });
      expect(record?.environment).toBeUndefined();
      expect(String(record?.refused)).toContain(String(world.port));
      expect(String(record?.fix)).toContain("proxy.port");
    } finally {
      await closed(squatter);
    }
  });

  it("publishes a refusal naming an enabled front door that did not start, with its cause", async () => {
    await session.stop();
    session = await startServing({ FIXTURE_FRONT_DOOR_FAILS: "1" });
    const record = readyRecord(world);
    expect(record).toMatchObject({ pid: session.process.pid });
    expect(record?.environment).toBeUndefined();
    expect(String(record?.refused)).toContain(FRONT_DOOR);
    expect(String(record?.refused)).toContain("the fixture front door was told to fail");
    expect(String(record?.fix)).toContain(FRONT_DOOR);
  });
});
