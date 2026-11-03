import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FileRef } from "../catalog/catalog.js";
import { CacheRefusal } from "./cache-refusal.js";
import type { Fetcher } from "./fetcher.js";

type Rename = (from: string, to: string) => Promise<void>;

/** Test seams into storing; a host passes none. */
export interface StoreSeams {
  /** Replaces the rename that moves verified bytes into place, so a test can make it fail. */
  rename?: Rename;
}

function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function matches(bytes: Uint8Array, reference: FileRef): boolean {
  return bytes.length === reference.size && sha256Of(bytes) === reference.sha256;
}

async function readIfPresent(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

function errorCodeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : String((error as Error)?.message ?? error);
}

function verified(bytes: Uint8Array, reference: FileRef): Uint8Array {
  if (bytes.length !== reference.size) {
    throw new CacheRefusal(`${reference.url} served ${bytes.length} bytes, but the catalog says ${reference.size} with SHA-256 ${reference.sha256}`, "never use it: ask the catalog's publisher to correct the file or its entry");
  }
  const actual = sha256Of(bytes);
  if (actual !== reference.sha256) {
    throw new CacheRefusal(`${reference.url} has SHA-256 ${actual}, but the catalog says ${reference.sha256}`, "never use it: ask the catalog's publisher to correct the file or its entry");
  }
  return bytes;
}

/**
 * Moves verified bytes into place, accepting a destination another process already put there.
 *
 * @implNote Written beside its final name and renamed, so a run killed mid-write leaves a stray
 * temporary file rather than a truncated file under the real name. On Windows a rename onto a file
 * another process has loaded fails with `EPERM`; when two hosts share one cache that file is the
 * very one being written, so the destination is re-hashed and accepted when it matches.
 */
async function storeVerified(path: string, bytes: Uint8Array, reference: FileRef, renameInto: Rename): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await renameInto(temporary, path);
  } catch (error) {
    const present = await readIfPresent(path);
    if (present && matches(present, reference)) return;
    throw new CacheRefusal(`${path} could not be written: ${errorCodeOf(error)}`, "free the cached file or point SPISOR_CACHE at a writable directory, then try again");
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Makes `path` hold the file `reference` names, answering whether it was already there.
 *
 * @remarks A cached file is hashed on every read and never trusted for existing; fetched bytes
 * that do not match are refused before anything is written.
 */
export async function storeFile(reference: FileRef, path: string, fetcher: Fetcher, seams: StoreSeams = {}): Promise<"cached" | "fetched"> {
  const cached = await readIfPresent(path);
  if (cached && matches(cached, reference)) return "cached";
  const bytes = verified(await fetcher.fetch(reference.url), reference);
  await mkdir(dirname(path), { recursive: true });
  await storeVerified(path, bytes, reference, seams.rename ?? rename);
  return "fetched";
}
