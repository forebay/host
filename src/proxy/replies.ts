import type { ServerResponse } from "node:http";
import type { IrFailure, WireReply } from "../contracts/index.js";

const JSON_HEADERS = { "content-type": "application/json" };

export function writeReply(response: ServerResponse, reply: WireReply | IrFailure): void {
  response.writeHead(reply.status, reply.headers);
  response.end(reply.body);
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
