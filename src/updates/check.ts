import { mkdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readCatalog } from "../catalog/catalog.js";
import type { Catalog } from "../catalog/catalog.js";
import type { CatalogSource } from "../catalog/sources.js";
import { sha256Of } from "../cache/sha256.js";
import { writeIntoPlace } from "../cache/store.js";
import { isRecord } from "../plugins/is-record.js";

const HOUR_MS = 3_600_000;

/** What the cache keeps about one catalog source between starts. */
export interface CatalogState {
  etag?: string;
  /** When the last SUCCESSFUL check ended; a failed one never moves it, so the next start retries. */
  checkedAt?: string;
  index?: string;
}

export type CatalogCheck = { kind: "skipped" } | { kind: "unchanged" } | { kind: "changed"; catalog: Catalog } | { kind: "failed"; detail: string };

export type CatalogAnswer = { status: 200; body: string; etag?: string } | { status: 304 };

/** How an `https` catalog index is asked for, conditionally on the etag the last answer carried. */
export interface CatalogTransport {
  get(url: string, etag?: string): Promise<CatalogAnswer>;
}

function locationOf(source: CatalogSource): string {
  return source.kind === "local" ? resolve(source.path) : source.url;
}

function originOf(source: CatalogSource): string {
  return source.kind === "local" ? pathToFileURL(resolve(source.path)).href : source.url;
}

function stateFrom(text: string): CatalogState {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) return {};
    const state: CatalogState = {};
    if (typeof value.etag === "string") state.etag = value.etag;
    if (typeof value.checkedAt === "string") state.checkedAt = value.checkedAt;
    if (typeof value.index === "string") state.index = value.index;
    return state;
  } catch {
    return {};
  }
}

function readState(cache: string, source: CatalogSource): CatalogState {
  try {
    return stateFrom(readFileSync(catalogStatePath(cache, source), "utf8"));
  } catch {
    return {};
  }
}

async function writeState(cache: string, source: CatalogSource, state: CatalogState): Promise<void> {
  const path = catalogStatePath(cache, source);
  await mkdir(dirname(path), { recursive: true });
  await writeIntoPlace(path, Buffer.from(`${JSON.stringify(state, null, 2)}\n`));
}

function isWithinInterval(state: CatalogState, now: Date, intervalHours: number): boolean {
  if (state.checkedAt === undefined) return false;
  const elapsed = now.getTime() - Date.parse(state.checkedAt);
  return elapsed >= 0 && elapsed < intervalHours * HOUR_MS;
}

function failed(detail: string): CatalogCheck {
  return { kind: "failed", detail };
}

async function accept(cache: string, source: CatalogSource, previous: CatalogState, next: CatalogState): Promise<CatalogCheck> {
  const reading = readCatalog(next.index as string, originOf(source));
  if (!reading.ok) return failed(`${locationOf(source)} served an index the host refuses: ${reading.refusal.detail}`);
  await writeState(cache, source, next);
  return next.index === previous.index ? { kind: "unchanged" } : { kind: "changed", catalog: reading.catalog };
}

async function checkLocal(source: CatalogSource & { kind: "local" }, cache: string, now: Date): Promise<CatalogCheck> {
  const previous = readState(cache, source);
  const index = await readFile(resolve(source.path), "utf8");
  return accept(cache, source, previous, { checkedAt: now.toISOString(), index });
}

async function checkHttps(source: CatalogSource & { kind: "https" }, cache: string, now: Date, intervalHours: number, transport: CatalogTransport): Promise<CatalogCheck> {
  if (!source.url.startsWith("https://")) return failed(`${source.url} is not an https url; serve the catalog over https or name a local path`);
  const previous = readState(cache, source);
  if (isWithinInterval(previous, now, intervalHours)) return { kind: "skipped" };
  const etag = previous.index === undefined ? undefined : previous.etag;
  const answer = await transport.get(source.url, etag);
  if (answer.status === 304) {
    if (previous.index === undefined) return failed(`${source.url} answered 304 to a request that carried no etag`);
    await writeState(cache, source, { ...previous, checkedAt: now.toISOString() });
    return { kind: "unchanged" };
  }
  return accept(cache, source, previous, { ...(answer.etag === undefined ? {} : { etag: answer.etag }), checkedAt: now.toISOString(), index: answer.body });
}

/** Where the cache keeps one source's {@link CatalogState}: named by the SHA-256 of its path or url. */
export function catalogStatePath(cache: string, source: CatalogSource): string {
  return join(cache, "catalog", `${sha256Of(Buffer.from(locationOf(source)))}.json`);
}

/**
 * Asks one source whether its catalog index changed, at most once per `intervalHours` for `https`.
 *
 * @remarks A `local` source is read from disk on every check and never reaches the transport. Any
 * failure, the transport's or the index's, answers `failed` and leaves the kept state untouched.
 */
export async function checkCatalog(source: CatalogSource, cache: string, now: Date, intervalHours: number, transport: CatalogTransport): Promise<CatalogCheck> {
  try {
    return source.kind === "local" ? await checkLocal(source, cache, now) : await checkHttps(source, cache, now, intervalHours, transport);
  } catch (error) {
    return failed(`${locationOf(source)} could not be checked: ${(error as Error).message}`);
  }
}

/**
 * The catalog this start resolves versions from, with no request: a `local` source's index as it is
 * on disk, an `https` source's index as the last successful check kept it.
 */
export function currentCatalog(source: CatalogSource, cache: string): Catalog | undefined {
  let index: string | undefined;
  try {
    index = source.kind === "local" ? readFileSync(resolve(source.path), "utf8") : readState(cache, source).index;
  } catch {
    return undefined;
  }
  if (index === undefined) return undefined;
  const reading = readCatalog(index, originOf(source));
  return reading.ok ? reading.catalog : undefined;
}
