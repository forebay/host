import type { InstalledVersion, InstallRefusal } from "../cache/install-version.js";
import type { RefusedCommand } from "../registration.js";

/** What the install did about one catalog application: `installed` covers one already installed and one it just installed through `installedThrough`. */
export interface ApplicationReport {
  id: string;
  state: "installed" | "detected" | "skipped" | "missing" | "unavailable" | "failed";
  installedThrough?: string;
  /** The methods that could be chosen, in the order they were offered. */
  offered?: string[];
  /** The exact flag that installs it through the first offered method, for a run with no terminal. */
  flag?: string;
  unavailable?: Array<{ method: string; detail: string; fix: string }>;
}

/** One loader the install registered as a host of its own, with the commands it holds and the ones the runtime refused. */
export interface LoaderReport {
  id: string;
  application: string;
  home: string;
  commands: string[];
  refusedCommands: RefusedCommand[];
}

/** What one install did: what it fetched, what was already in the cache as `<id>@<version>`, what it could not install, which plugins it enabled and what it did about each catalog application. */
export interface InstallReport {
  installed: Array<{ id: string; version: string }>;
  cached: string[];
  unavailable: Array<{ id: string; detail: string; fix: string }>;
  enabled: string[];
  applications: ApplicationReport[];
  loaders: LoaderReport[];
}

export function emptyReport(): InstallReport {
  return { installed: [], cached: [], unavailable: [], enabled: [], applications: [], loaders: [] };
}

export function recordAnswer(report: InstallReport, answer: InstalledVersion | InstallRefusal): void {
  if (!answer.ok) report.unavailable.push({ id: answer.id, detail: answer.detail, fix: answer.fix });
  else if (answer.fetched.length > 0) report.installed.push({ id: answer.id, version: answer.version });
  else report.cached.push(`${answer.id}@${answer.version}`);
}

/** `later` after `earlier` on the same items: what `earlier` fetched stays installed, not cached. */
export function mergeReports(earlier: InstallReport, later: InstallReport): InstallReport {
  const fetched = new Set(earlier.installed.map(({ id, version }) => `${id}@${version}`));
  return {
    installed: [...earlier.installed, ...later.installed],
    cached: later.cached.filter((name) => !fetched.has(name)),
    unavailable: later.unavailable,
    enabled: later.enabled,
    applications: later.applications,
    loaders: later.loaders,
  };
}
