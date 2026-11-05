import type { IncomingHttpHeaders, IncomingMessage } from "node:http";

/** A request as the session host received it, its whole body read. */
export interface BufferedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export function bufferedRequest(request: IncomingMessage): Promise<BufferedRequest> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve({ method: request.method ?? "GET", url: request.url ?? "/", headers: request.headers, body: Buffer.concat(chunks) }));
  });
}

/** The headers as single strings, the shape a front door reads; a repeated header is joined as HTTP joins it. */
export function flatHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).flatMap(([name, value]) => (value === undefined ? [] : [[name, Array.isArray(value) ? value.join(", ") : value]])));
}
