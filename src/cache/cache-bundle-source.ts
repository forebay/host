import { join } from "node:path";
import { bundleInFolder } from "../plugins/bundle-source.js";
import type { BundleEntry, BundleSource } from "../plugins/bundle-source.js";
import { checkInstalled } from "./install-marker.js";

/** Why an installed version was not run, so the caller can report it and install it again. */
export interface BundleProblem {
  id: string;
  version: string;
  detail: string;
  fix: string;
  file?: string;
}

export interface CacheBundleSource extends BundleSource {
  /** The latest problem each id's `locate` met; an id that later locates cleanly is dropped. */
  problems(): BundleProblem[];
}

type Located = { entry: BundleEntry | null } | { problem: Omit<BundleProblem, "id" | "version"> };

function manifestVersionProblem(entry: BundleEntry, directory: string, version: string): Located {
  return {
    problem: {
      detail: `plugin.json in ${directory} names version ${entry.version ?? "(none)"}, not ${version}`,
      fix: "ask the catalog's publisher to give plugin.json the version the catalog lists it under",
      file: "plugin.json",
    },
  };
}

function locateVersion(directory: string, id: string, version: string): Located {
  const check = checkInstalled(directory);
  if (check.kind === "absent") return { entry: null };
  if (check.kind === "damaged") return { problem: { detail: check.detail, fix: check.fix, ...(check.file === undefined ? {} : { file: check.file }) } };
  const entry = bundleInFolder(directory, id);
  if (entry !== null && entry.version !== version) return manifestVersionProblem(entry, directory, version);
  return { entry };
}

/**
 * Bundles installed in the cache, each id at the one version `versions` names for this start.
 *
 * @remarks Only a version whose install completed is seen, and every file it recorded is
 * re-hashed on each `locate`: a damaged version answers null and is reported through `problems`.
 */
export function cacheBundleSource(cache: string, versions: Record<string, string>): CacheBundleSource {
  const problems = new Map<string, BundleProblem>();
  const locate = (id: string): BundleEntry | null => {
    if (!Object.hasOwn(versions, id)) return null;
    const version = versions[id] as string;
    const located = locateVersion(join(cache, "bundles", id, version), id, version);
    if ("problem" in located) {
      problems.set(id, { id, version, ...located.problem });
      return null;
    }
    problems.delete(id);
    return located.entry;
  };
  return {
    list: () => Object.keys(versions).sort().flatMap((id) => locate(id) ?? []),
    locate,
    problems: () => [...problems.values()],
  };
}
