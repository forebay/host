import type { ServerResponse } from "node:http";
import type { IrFailure, WireReply } from "../contracts/index.js";

const JSON_HEADERS = { "content-type": "application/json" };
const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "te", "trailer"]);
const REFRAMED = new Set(["content-encoding", "content-length"]);

export function writeReply(response: ServerResponse, reply: WireReply | IrFailure): void {
  response.writeHead(reply.status, reply.headers);
  response.end(reply.body);
}

function namedInConnection(headers: Record<string, string>): Set<string> {
  const connection = Object.entries(headers).find(([name]) => name.toLowerCase() === "connection")?.[1] ?? "";
  return new Set(connection.split(",").map((name) => name.trim().toLowerCase()).filter((name) => name !== ""));
}

/**
 * A provider's headers fit to send with a body the host writes itself: its upstream's encoding and
 * length describe bytes the provider already decoded, and hop-by-hop headers belong to its own
 * connection, not to this one.
 */
export function endToEndHeaders(headers: Record<string, string>): Record<string, string> {
  const connectionHeaders = namedInConnection(headers);
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => {
      const lower = name.toLowerCase();
      return !HOP_BY_HOP.has(lower) && !REFRAMED.has(lower) && !lower.startsWith("proxy-") && !connectionHeaders.has(lower);
    }),
  );
}

export function writeProviderFailure(response: ServerResponse, failure: IrFailure): void {
  writeReply(response, { status: failure.status, headers: endToEndHeaders(failure.headers), body: failure.body });
}

export function writeJson(response: ServerResponse, status: number, body: unknown): void {
  writeReply(response, { status, headers: JSON_HEADERS, body: JSON.stringify(body) });
}

/** An answer the session host itself gives, in the error envelope the loader proxy has always answered with. */
export function writeProxyError(response: ServerResponse, status: number, message: string): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  writeJson(response, status, { type: "error", error: { type: "loader_proxy_error", message } });
}

/** An answer in the Anthropic API's own error envelope, which the application reads as it reads an upstream error. */
export function writeApiError(response: ServerResponse, status: number, message: string): void {
  writeJson(response, status, { type: "error", error: { type: "api_error", message } });
}
