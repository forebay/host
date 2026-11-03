import type { InstalledVersion, InstallRefusal } from "../cache/install-version.js";

/** What one install did: what it fetched, what was already in the cache as `<id>@<version>`, what it could not install, and which plugins it enabled. */
export interface InstallReport {
  installed: Array<{ id: string; version: string }>;
  cached: string[];
  unavailable: Array<{ id: string; detail: string; fix: string }>;
  enabled: string[];
}

export function emptyReport(): InstallReport {
  return { installed: [], cached: [], unavailable: [], enabled: [] };
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
  };
}
