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
  /** The bytes `url` names; with `expectedSize`, an https answer is abandoned the moment it serves more. */
  fetch(url: string, expectedSize?: number): Promise<Uint8Array>;
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

function oversized(url: string, expectedSize: number): CacheRefusal {
  return new CacheRefusal(`${url} served more than the ${expectedSize} bytes the catalog lists`, "never use it: ask the catalog's publisher to correct the file or its entry");
}

function declaredLength(response: Response): number | undefined {
  const header = response.headers.get("content-length");
  return header === null || !/^[0-9]+$/.test(header) ? undefined : Number(header);
}

async function boundedBytes(url: string, body: ReadableStream<Uint8Array>, expectedSize: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    total += read.value.length;
    if (total > expectedSize) {
      await reader.cancel();
      throw oversized(url, expectedSize);
    }
    chunks.push(read.value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function responseBytes(url: string, fetchImplementation: typeof fetch, signal: AbortSignal, expectedSize: number | undefined): Promise<Uint8Array> {
  const response = await fetchImplementation(url, { signal });
  if (!response.ok) throw new CacheRefusal(`${url} answered HTTP ${response.status}`, "check that the catalog still publishes this file");
  if (expectedSize === undefined || response.body === null) return new Uint8Array(await response.arrayBuffer());
  if ((declaredLength(response) ?? 0) > expectedSize) {
    await response.body.cancel();
    throw oversized(url, expectedSize);
  }
  return boundedBytes(url, response.body, expectedSize);
}

async function fetchHttps(url: string, fetchImplementation: typeof fetch, deadlineMs: number, expectedSize: number | undefined): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(deadlineMs);
  try {
    return await untilDeadline(responseBytes(url, fetchImplementation, signal, expectedSize), signal);
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
    async fetch(url, expectedSize) {
      const scheme = schemeOf(url);
      if (scheme === "file:") return readFileUrl(url);
      if (scheme === "https:") return fetchHttps(url, fetchImplementation, deadlineMs, expectedSize);
      throw new CacheRefusal(`${url} uses the scheme ${scheme || "(none)"}, which the cache does not fetch`, "serve the catalog's files over https or from a local directory");
    },
  };
}

/** Reads `file:` urls from disk and `https:` urls from the network; every other scheme is refused. */
export function defaultFetcher(): Fetcher {
  return fetcherWith({});
}
