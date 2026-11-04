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

/** @implNote The bare name comes last, so an extensionless npm shell script never wins over the `.cmd` beside it that Windows can run. */
function windowsNames(binary: string, environment: Record<string, string>): string[] {
  const extensions = (variable(environment, "PATHEXT", "win32") || DEFAULT_PATHEXT).split(";").filter((extension) => extension !== "");
  return [...extensions.map((extension) => binary + extension), binary].map((name) => name.toLowerCase());
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

function matchesIn(directory: string, accepted: readonly string[], spelling: (entry: string) => string, requireExecuteBit: boolean): string | undefined {
  const entries = entriesOf(directory);
  for (const wanted of accepted) {
    const entry = entries.find((name) => spelling(name) === wanted && isRegularFile(join(directory, name), requireExecuteBit));
    if (entry !== undefined) return join(directory, entry);
  }
  return undefined;
}

/**
 * The executable a bare command name resolves to on PATH, or undefined.
 *
 * @implNote Reads directories and stats files only and never launches anything. Windows matches
 * the name with each `PATHEXT` extension in its order, then the bare name, case-insensitively; POSIX
 * requires a regular file with any execute bit. `platform` is a parameter so both branches run on any OS.
 */
export function findOnPath(binary: string, environment: Record<string, string>, platform: NodeJS.Platform = process.platform): string | undefined {
  const windows = isWindows(platform);
  const accepted = windows ? windowsNames(binary, environment) : [binary];
  const spelling = (entry: string): string => (windows ? entry.toLowerCase() : entry);
  for (const directory of pathDirectories(environment, platform)) {
    const found = matchesIn(directory, accepted, spelling, !windows);
    if (found !== undefined) return found;
  }
  return undefined;
}
