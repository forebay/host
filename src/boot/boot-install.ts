import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { MODULE_MARKER_CONTENT } from "../cache/module-marker.js";
import { CacheRefusal } from "../cache/cache-refusal.js";

export const BOOT_ENTRY_NAME = "boot.js";

/** Where the versionless boot entry of `cache` lives; the same path for every version of every host. */
export function bootEntryFile(cache: string): string {
  return join(cache, "boot", BOOT_ENTRY_NAME);
}

function readIfPresent(path: string): Buffer | undefined {
  try {
    return readFileSync(path);
  } catch {
    return undefined;
  }
}

/** @implNote Compares content, never existence, so an entry an older host left is replaced; written beside its name and renamed so a command never runs half of it. */
function writeIfDifferent(path: string, bytes: Buffer | string): void {
  const wanted = Buffer.from(bytes);
  if (readIfPresent(path)?.equals(wanted) === true) return;
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, wanted);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Makes `<cache>/boot/boot.js` the one the installed host bundle in `bundleDirectory` carries, replacing a different one. */
export function installBootEntry(cache: string, bundleDirectory: string): void {
  const source = readIfPresent(join(bundleDirectory, BOOT_ENTRY_NAME));
  if (source === undefined) throw new CacheRefusal(`the host bundle in ${bundleDirectory} carries no ${BOOT_ENTRY_NAME}`, "install a host version built with a boot entry");
  mkdirSync(join(cache, "boot"), { recursive: true });
  writeIfDifferent(bootEntryFile(cache), source);
  writeIfDifferent(join(cache, "boot", "package.json"), MODULE_MARKER_CONTENT);
}
