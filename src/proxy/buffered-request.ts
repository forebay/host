import type { IncomingHttpHeaders, IncomingMessage } from "node:http";

/** A request as the session host received it, its whole body read. */
export interface BufferedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export class RequestTooLarge extends Error {
  constructor(maxBytes: number) {
    super(`the request body is larger than the ${maxBytes} bytes the proxy accepts`);
  }
}

/** The whole body of a request, refused with `RequestTooLarge` as soon as it is known to pass `maxBytes`. */
export function bufferedRequest(request: IncomingMessage, maxBytes: number): Promise<BufferedRequest> {
  return new Promise((resolve, reject) => {
    if (Number(request.headers["content-length"] ?? 0) > maxBytes) {
      reject(new RequestTooLarge(maxBytes));
      return;
    }
    let chunks: Buffer[] = [];
    let received = 0;
    const keep = (chunk: Buffer): void => {
      received += chunk.length;
      chunks.push(chunk);
      if (received <= maxBytes) return;
      chunks = [];
      request.off("data", keep);
      reject(new RequestTooLarge(maxBytes));
    };
    request.on("data", keep);
    request.on("error", reject);
    request.on("end", () => resolve({ method: request.method ?? "GET", url: request.url ?? "/", headers: request.headers, body: Buffer.concat(chunks) }));
  });
}

/** The headers as single strings, the shape a front door reads; a repeated header is joined as HTTP joins it. */
export function flatHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).flatMap(([name, value]) => (value === undefined ? [] : [[name, Array.isArray(value) ? value.join(", ") : value]])));
}
