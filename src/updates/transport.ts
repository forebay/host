import type { CatalogAnswer, CatalogTransport } from "./check.js";

/** How long one catalog index request may take, every redirect included, from the request to its last byte. */
const INDEX_DEADLINE_MS = 30_000;
const MAXIMUM_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function answerOf(response: Response, url: string): Promise<CatalogAnswer> {
  if (response.status === 304) return { status: 304 };
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  const body = await response.text();
  const etag = response.headers.get("etag");
  return etag === null ? { status: 200, body } : { status: 200, body, etag };
}

function redirectTarget(response: Response, url: string): string {
  const location = response.headers.get("location");
  if (location === null) throw new Error(`${url} answered HTTP ${response.status} with no location`);
  const target = new URL(location, url).href;
  if (!target.startsWith("https://")) throw new Error(`${url} redirects to ${target}, which is not https`);
  return target;
}

/**
 * A transport over an injected fetch.
 *
 * @internal A test seam, kept out of the package entry.
 * @implNote Redirects are followed by hand, because `fetch` would follow one off https without
 * asking, and the catalog's integrity rests on every hop being https.
 */
export function catalogTransportWith(fetchImplementation: typeof fetch): CatalogTransport {
  return {
    async get(url, etag) {
      const headers: Record<string, string> = etag === undefined ? {} : { "If-None-Match": etag };
      const signal = AbortSignal.timeout(INDEX_DEADLINE_MS);
      let current = url;
      for (let hop = 0; hop <= MAXIMUM_REDIRECTS; hop++) {
        const response = await fetchImplementation(current, { headers, signal, redirect: "manual" });
        if (!REDIRECT_STATUSES.has(response.status)) return answerOf(response, current);
        current = redirectTarget(response, current);
      }
      throw new Error(`${url} redirected more than ${MAXIMUM_REDIRECTS} times`);
    },
  };
}

/** Asks for a catalog index over https with `If-None-Match`, refusing any redirect off https. */
export function defaultCatalogTransport(): CatalogTransport {
  return catalogTransportWith(fetch);
}
