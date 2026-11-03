import { statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { userHomeOf } from "../user-home.js";
import { HomeRefusal } from "./home-refusal.js";
import type { LoaderApplication } from "./standard.js";

export type ApplicationHome = { home: string; source: "override" | "native" | "candidate" | "default" };

const HOME_PREFIX = "~/";

function variableValue(environment: Record<string, string>, name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const value = environment[name];
  return value === undefined || value === "" ? undefined : value;
}

function absoluteVariable(name: string, value: string): string {
  if (isAbsolute(value)) return value;
  throw new HomeRefusal(`${name} is "${value}", which is a relative path`, `set ${name} to an absolute path, or unset it`);
}

function expandCandidate(candidate: string, environment: Record<string, string>): string {
  return candidate.startsWith(HOME_PREFIX) ? join(userHomeOf(environment), candidate.slice(HOME_PREFIX.length)) : candidate;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * @implNote The order mirrors how the application itself finds its home, because a loader records
 * the result and a different answer would point the registration at a directory the application
 * never reads. An empty variable counts as unset, as the applications treat it.
 */
export function resolveApplicationHome(standard: LoaderApplication["home"], environment: Record<string, string>): ApplicationHome {
  for (const [source, name] of [["override", standard.envOverride], ["native", standard.nativeEnv]] as const) {
    const value = variableValue(environment, name);
    if (name !== undefined && value !== undefined) return { home: absoluteVariable(name, value), source };
  }
  const candidates = standard.candidates.map((candidate) => expandCandidate(candidate, environment));
  const existing = candidates.find(isDirectory);
  return existing === undefined ? { home: candidates[0], source: "default" } : { home: existing, source: "candidate" };
}
