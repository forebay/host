import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CacheRefusal } from "./cache-refusal.js";

/**
 * How long one https file may take, from the request to its last byte.
 *
 * @implNote weivel's `DOWNLOAD_DEADLINE_MS`: fetch has no per-phase timeouts, so one overall
 * deadline stands for Java's 15 s connect plus 60 s read.
 */
const DOWNLOAD_DEADLINE_MS = 75_000;

export interface Fetcher {
  fetch(url: string): Promise<Uint8Array>;
}

/** @internal Test seams into fetching, reached through {@link fetcherWith}; not part of the package entry. */
export interface FetcherOptions {
  fetchImplementation?: typeof fetch;
  deadlineMs?: number;
}

/**
 * @implNote `fileURLToPath` is the only decoder: it refuses an encoded `/` or `\`, so a url can
 * never name a different path than the one the catalog's containment check saw.
 */
async function readFileUrl(url: string): Promise<Uint8Array> {
  const host = new URL(url).hostname;
  if (host !== "") {
    throw new CacheRefusal(`${url} names the host ${host}, which would read from a network share`, "serve remote files over https and local ones by a file url with no host");
  }
  try {
    return new Uint8Array(await readFile(fileURLToPath(url)));
  } catch (error) {
    throw new CacheRefusal(`${url} could not be read: ${(error as Error).message}`, "check that the local catalog's files are where its index says");
  }
}

/** @implNote fetch ends a stuck download on its signal only if it observes it, so an injected fetch is raced too. */
async function untilDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort = (): void => {};
  const expired = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function responseBytes(url: string, fetchImplementation: typeof fetch, signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetchImplementation(url, { signal });
  if (!response.ok) throw new CacheRefusal(`${url} answered HTTP ${response.status}`, "check that the catalog still publishes this file");
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchHttps(url: string, fetchImplementation: typeof fetch, deadlineMs: number): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(deadlineMs);
  try {
    return await untilDeadline(responseBytes(url, fetchImplementation, signal), signal);
  } catch (error) {
    if (error instanceof CacheRefusal) throw error;
    const detail = signal.aborted ? `${url} did not finish within ${deadlineMs} ms` : `${url} could not be fetched: ${(error as Error).message}`;
    throw new CacheRefusal(detail, "check the network, then try again");
  }
}

function schemeOf(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return "";
  }
}

/** @internal A fetcher over an injected fetch and deadline, for tests; not part of the package entry. */
export function fetcherWith(options: FetcherOptions): Fetcher {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const deadlineMs = options.deadlineMs ?? DOWNLOAD_DEADLINE_MS;
  return {
    async fetch(url) {
      const scheme = schemeOf(url);
      if (scheme === "file:") return readFileUrl(url);
      if (scheme === "https:") return fetchHttps(url, fetchImplementation, deadlineMs);
      throw new CacheRefusal(`${url} uses the scheme ${scheme || "(none)"}, which the cache does not fetch`, "serve the catalog's files over https or from a local directory");
    },
  };
}

/** Reads `file:` urls from disk and `https:` urls from the network; every other scheme is refused. */
export function defaultFetcher(): Fetcher {
  return fetcherWith({});
}
