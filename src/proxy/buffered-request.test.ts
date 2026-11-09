import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { bufferedRequest, RequestTooLarge } from "./buffered-request.js";

const LIMIT = 8;

function incomingOf(chunks: string[], headers: Record<string, string> = {}): IncomingMessage {
  return Object.assign(Readable.from(chunks.map((chunk) => Buffer.from(chunk))), { method: "POST", url: "/v1/messages", headers }) as unknown as IncomingMessage;
}

describe("reading a request body under a limit", () => {
  it("answers a body of exactly the limit whole", async () => {
    const buffered = await bufferedRequest(incomingOf(["1234", "5678"]), LIMIT);
    expect(buffered.body.toString()).toBe("12345678");
  });

  it("refuses a declared length above the limit without reading any of it", async () => {
    const request = incomingOf(["123456789"], { "content-length": "9" });
    await expect(bufferedRequest(request, LIMIT)).rejects.toBeInstanceOf(RequestTooLarge);
    expect(request.listenerCount("data")).toBe(0);
  });

  it("refuses a body with no declared length once it passes the limit, and stops keeping it", async () => {
    const request = incomingOf(["12345", "67890", "abcde"]);
    await expect(bufferedRequest(request, LIMIT)).rejects.toThrow(`larger than the ${LIMIT} bytes`);
    expect(request.listenerCount("data")).toBe(0);
  });
});
