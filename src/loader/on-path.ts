import { readdirSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";
const ANY_EXECUTE_BIT = 0o111;

function isWindows(platform: NodeJS.Platform): boolean {
  return platform === "win32";
}

/** @implNote Windows environment names are case-insensitive, so `Path` and `PATH` are the same variable there. */
function variable(environment: Record<string, string>, name: string, platform: NodeJS.Platform): string | undefined {
  if (!isWindows(platform)) return environment[name];
  const key = Object.keys(environment).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : environment[key];
}

function pathDirectories(environment: Record<string, string>, platform: NodeJS.Platform): string[] {
  const separator = isWindows(platform) ? ";" : delimiter;
  return (variable(environment, "PATH", platform) ?? "").split(separator).filter((directory) => directory !== "");
}

function windowsNames(binary: string, environment: Record<string, string>): string[] {
  const extensions = (variable(environment, "PATHEXT", "win32") || DEFAULT_PATHEXT).split(";").filter((extension) => extension !== "");
  return [binary, ...extensions.map((extension) => binary + extension)].map((name) => name.toLowerCase());
}

function entriesOf(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

function isRegularFile(path: string, requireExecuteBit: boolean): boolean {
  try {
    const status = statSync(path);
    return status.isFile() && (!requireExecuteBit || (status.mode & ANY_EXECUTE_BIT) !== 0);
  } catch {
    return false;
  }
}

function matchesIn(directory: string, accepts: (entry: string) => boolean, requireExecuteBit: boolean): string | undefined {
  const entry = entriesOf(directory).find((name) => accepts(name) && isRegularFile(join(directory, name), requireExecuteBit));
  return entry === undefined ? undefined : join(directory, entry);
}

/**
 * The executable a bare command name resolves to on PATH, or undefined.
 *
 * @implNote Reads directories and stats files only and never launches anything. Windows matches
 * the name against the bare name and each `PATHEXT` extension case-insensitively; POSIX requires a
 * regular file with any execute bit. `platform` is a parameter so both branches run on any OS.
 */
export function findOnPath(binary: string, environment: Record<string, string>, platform: NodeJS.Platform = process.platform): string | undefined {
  const windows = isWindows(platform);
  const accepted = windows ? windowsNames(binary, environment) : [binary];
  const accepts = (entry: string): boolean => accepted.includes(windows ? entry.toLowerCase() : entry);
  for (const directory of pathDirectories(environment, platform)) {
    const found = matchesIn(directory, accepts, !windows);
    if (found !== undefined) return found;
  }
  return undefined;
}
