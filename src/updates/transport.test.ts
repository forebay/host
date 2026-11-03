import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { catalogTransportWith, defaultCatalogTransport } from "./transport.js";

let server: Server;
let url: string;
let status = 200;
let paths: string[];

beforeEach(async () => {
  status = 200;
  paths = [];
  server = createServer((request, response) => {
    paths.push(request.url ?? "");
    if (request.url === "/moved") return response.writeHead(302, { location: "/elsewhere" }).end();
    if (status !== 200) return response.writeHead(status).end();
    if (request.headers["if-none-match"] === "\"one\"") return response.writeHead(304).end();
    response.writeHead(200, { etag: "\"one\"" }).end("{\"format\":1}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function redirecting(hops: Record<string, string>): { fetched: string[]; implementation: typeof fetch } {
  const fetched: string[] = [];
  const implementation = (async (input: string | URL | Request) => {
    const target = String(input);
    fetched.push(target);
    const location = hops[target];
    return location === undefined ? new Response("{\"format\":1}", { status: 200 }) : new Response(null, { status: 302, headers: { location } });
  }) as typeof fetch;
  return { fetched, implementation };
}

describe("defaultCatalogTransport", () => {
  it("answers the body and its etag, then a 304 when asked with that etag", async () => {
    const transport = defaultCatalogTransport();
    expect(await transport.get(`${url}/index.json`)).toEqual({ status: 200, body: "{\"format\":1}", etag: "\"one\"" });
    expect(await transport.get(`${url}/index.json`, "\"one\"")).toEqual({ status: 304 });
  });

  it("throws on any other status", async () => {
    status = 503;
    await expect(defaultCatalogTransport().get(`${url}/index.json`)).rejects.toThrow(/HTTP 503/);
  });

  it("refuses a redirect to a url that is not https, without following it", async () => {
    await expect(defaultCatalogTransport().get(`${url}/moved`)).rejects.toThrow(/not https/);
    expect(paths).toEqual(["/moved"]);
  });
});

describe("catalogTransportWith", () => {
  it("follows a redirect from https to https, resolving a relative location", async () => {
    const { fetched, implementation } = redirecting({ "https://a.test/index.json": "/v2/index.json" });
    expect(await catalogTransportWith(implementation).get("https://a.test/index.json")).toMatchObject({ status: 200 });
    expect(fetched).toEqual(["https://a.test/index.json", "https://a.test/v2/index.json"]);
  });

  it("refuses a redirect off https at any hop", async () => {
    const { fetched, implementation } = redirecting({ "https://a.test/index.json": "https://b.test/index.json", "https://b.test/index.json": "http://c.test/index.json" });
    await expect(catalogTransportWith(implementation).get("https://a.test/index.json")).rejects.toThrow("https://b.test/index.json redirects to http://c.test/index.json, which is not https");
    expect(fetched).toEqual(["https://a.test/index.json", "https://b.test/index.json"]);
  });

  it("refuses a redirect loop", async () => {
    const { implementation } = redirecting({ "https://a.test/index.json": "https://a.test/index.json" });
    await expect(catalogTransportWith(implementation).get("https://a.test/index.json")).rejects.toThrow(/redirect/);
  });
});
