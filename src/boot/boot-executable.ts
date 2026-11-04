import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { CacheRefusal } from "../cache/cache-refusal.js";
import { isRecord } from "../plugins/is-record.js";

const EXECUTABLE_FILE = "javascript.json";
const REINSTALL_FIX = "run forebay-host install --catalog <path or url> again";

function executableFile(cache: string): string {
  return join(cache, "boot", EXECUTABLE_FILE);
}

/**
 * Records `executable` as the JavaScript runtime every command, hook and background host of `cache`
 * runs the boot entry with.
 *
 * @implNote Recorded once, by install, because a host started inside an application (OpenCode loads
 * the boot entry into its own process) sees that application's executable as `process.execPath`.
 * Written beside its name and renamed, so a reader never sees half of it.
 */
export function recordBootExecutable(cache: string, executable: string): void {
  const file = executableFile(cache);
  mkdirSync(join(cache, "boot"), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify({ executable }, null, 2)}\n`);
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** The JavaScript runtime install recorded for `cache`, refused with the reinstall fix when none is. */
export function bootExecutable(cache: string): string {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(executableFile(cache), "utf8"));
  } catch {
    value = undefined;
  }
  if (isRecord(value) && typeof value.executable === "string" && value.executable !== "") return value.executable;
  throw new CacheRefusal(`no JavaScript runtime is recorded for the boot entry of ${cache}`, REINSTALL_FIX);
}
