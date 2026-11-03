import type { CatalogAnswer, CatalogTransport } from "./check.js";

/** How long one catalog index request may take, from the request to its last byte. */
const INDEX_DEADLINE_MS = 30_000;

async function answerOf(response: Response, url: string): Promise<CatalogAnswer> {
  if (response.status === 304) return { status: 304 };
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  const body = await response.text();
  const etag = response.headers.get("etag");
  return etag === null ? { status: 200, body } : { status: 200, body, etag };
}

/** Asks for a catalog index over https with `If-None-Match`, giving up after a fixed deadline. */
export function defaultCatalogTransport(): CatalogTransport {
  return {
    async get(url, etag) {
      const headers: Record<string, string> = etag === undefined ? {} : { "If-None-Match": etag };
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(INDEX_DEADLINE_MS) });
      return answerOf(response, url);
    },
  };
}
