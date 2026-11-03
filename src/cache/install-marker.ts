import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isRecord } from "../plugins/is-record.js";
import { sha256Of } from "./sha256.js";
import { isStrictlyInside } from "./strictly-inside.js";
import { writeIntoPlace } from "./store.js";

/** The file an install writes last, so its presence means every file it names was stored and verified. */
export const INSTALL_MARKER = ".installed.json";

const SHA256 = /^[0-9a-f]{64}$/;
const REINSTALL_FIX = "install the version again; the cache refetches every file whose hash does not match";

export type InstalledCheck = { kind: "absent" } | { kind: "intact" } | { kind: "damaged"; detail: string; fix: string; file?: string };

type RecordedHashes = Record<string, string>;

function damaged(detail: string, file?: string): InstalledCheck {
  return { kind: "damaged", detail, fix: REINSTALL_FIX, ...(file === undefined ? {} : { file }) };
}

function recordedHashes(markerPath: string): RecordedHashes | undefined {
  try {
    const marker: unknown = JSON.parse(readFileSync(markerPath, "utf8"));
    if (!isRecord(marker) || !isRecord(marker.files)) return undefined;
    const entries = Object.entries(marker.files);
    return entries.every(([, hash]) => typeof hash === "string" && SHA256.test(hash)) ? (marker.files as RecordedHashes) : undefined;
  } catch {
    return undefined;
  }
}

function readIfPresent(path: string): Buffer | undefined {
  try {
    return readFileSync(path);
  } catch {
    return undefined;
  }
}

function checkFile(directory: string, key: string, recorded: string): InstalledCheck | undefined {
  const path = resolve(directory, key);
  if (key === INSTALL_MARKER || !isStrictlyInside(directory, path)) return damaged(`the completion marker names ${key}, which is not a file of ${directory}`, key);
  const bytes = readIfPresent(path);
  if (bytes === undefined) return damaged(`file ${key} of ${directory} is missing`, key);
  const actual = sha256Of(bytes);
  return actual === recorded ? undefined : damaged(`file ${key} of ${directory} has SHA-256 ${actual}, but its install recorded ${recorded}`, key);
}

export async function writeInstallMarker(directory: string, hashes: RecordedHashes): Promise<void> {
  await writeIntoPlace(join(directory, INSTALL_MARKER), Buffer.from(`${JSON.stringify({ files: hashes }, null, 2)}\n`));
}

/**
 * Whether the version in `directory` finished installing and every file still has its recorded hash.
 *
 * @remarks Local and network-free, so a host can afford it on every load (spec 7.2).
 */
export function checkInstalled(directory: string): InstalledCheck {
  const markerPath = join(directory, INSTALL_MARKER);
  if (!existsSync(markerPath)) return { kind: "absent" };
  const hashes = recordedHashes(markerPath);
  if (hashes === undefined) return damaged(`the completion marker ${markerPath} is not readable`);
  for (const [key, recorded] of Object.entries(hashes)) {
    const problem = checkFile(directory, key, recorded);
    if (problem !== undefined) return problem;
  }
  return { kind: "intact" };
}
