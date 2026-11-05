import { request as httpRequest } from "node:http";
import type { IncomingHttpHeaders, OutgoingHttpHeaders, ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import type { BufferedRequest } from "./buffered-request.js";

const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer"]);
const BAD_GATEWAY = 502;

function withoutHopByHop(headers: IncomingHttpHeaders, alsoDropped: readonly string[]): OutgoingHttpHeaders {
  return Object.fromEntries(Object.entries(headers).filter(([name, value]) => value !== undefined && !HOP_BY_HOP.has(name) && !alsoDropped.includes(name)));
}

/** @implNote The body is sent buffered, so its length is known and replaces whatever framing the application used. */
function forwardedHeaders(request: BufferedRequest, upstream: URL): OutgoingHttpHeaders {
  return { ...withoutHopByHop(request.headers, ["host", "content-length"]), host: upstream.host, "content-length": String(request.body.length) };
}

function targetPath(upstream: URL, url: string): string {
  return `${upstream.pathname.replace(/\/+$/, "")}${url}`;
}

function failed(response: ServerResponse, upstream: URL, error: unknown): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const message = `the upstream ${upstream.origin} could not be reached: ${error instanceof Error ? error.message : String(error)}`;
  response.writeHead(BAD_GATEWAY, { "content-type": "application/json" });
  response.end(JSON.stringify({ type: "error", error: { type: "loader_proxy_error", message } }));
}

/**
 * Forwards a request no chain entry serves to the profile's upstream: the method, path, headers and
 * body as the application sent them, and the upstream's answer back as it came.
 */
export function passThrough(request: BufferedRequest, upstream: string, response: ServerResponse, signal: AbortSignal): Promise<void> {
  const target = new URL(upstream);
  const send = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve) => {
    const outgoing = send(
      { protocol: target.protocol, hostname: target.hostname, port: target.port, method: request.method, path: targetPath(target, request.url), headers: forwardedHeaders(request, target), signal },
      (incoming) => {
        response.writeHead(incoming.statusCode ?? BAD_GATEWAY, withoutHopByHop(incoming.headers, []));
        incoming.pipe(response);
        incoming.on("end", () => resolve());
        incoming.on("error", (error) => {
          failed(response, target, error);
          resolve();
        });
      },
    );
    outgoing.on("error", (error) => {
      if (!signal.aborted) failed(response, target, error);
      resolve();
    });
    outgoing.end(request.body);
  });
}
