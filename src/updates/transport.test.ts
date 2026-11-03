import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultCatalogTransport } from "./transport.js";

let server: Server;
let url: string;
let status = 200;

beforeEach(async () => {
  status = 200;
  server = createServer((request, response) => {
    if (status !== 200) return response.writeHead(status).end();
    if (request.headers["if-none-match"] === "\"one\"") return response.writeHead(304).end();
    response.writeHead(200, { etag: "\"one\"" }).end("{\"format\":1}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/index.json`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("defaultCatalogTransport", () => {
  it("answers the body and its etag, then a 304 when asked with that etag", async () => {
    const transport = defaultCatalogTransport();
    expect(await transport.get(url)).toEqual({ status: 200, body: "{\"format\":1}", etag: "\"one\"" });
    expect(await transport.get(url, "\"one\"")).toEqual({ status: 304 });
  });

  it("throws on any other status", async () => {
    status = 503;
    await expect(defaultCatalogTransport().get(url)).rejects.toThrow(/HTTP 503/);
  });
});
