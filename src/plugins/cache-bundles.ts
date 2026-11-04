import { join } from "node:path";
import type { Runtime } from "../runtime/open.js";
import { bundleInFolder } from "./bundle-source.js";
import type { BundleEntry, BundleSource } from "./bundle-source.js";

/** Why an installed version was not run, so it can be reported and installed again. */
export interface BundleProblem {
  id: string;
  version: string;
  detail: string;
  fix: string;
  file?: string;
}

export interface CacheBundles extends BundleSource {
  /** The latest problem each id's `locate` met; an id that later locates cleanly is dropped. */
  problems(): BundleProblem[];
}

type Located = { entry: BundleEntry | null } | { problem: Omit<BundleProblem, "id" | "version"> };

const REINSTALL_FIX = "ask the catalog's publisher to give plugin.json the version the catalog lists it under";

function locateVersion(runtime: Pick<Runtime, "cache">, directory: string, id: string, version: string): Located {
  const check = runtime.cache.check({ directory });
  if (check.kind === "absent") return { entry: null };
  if (check.kind === "damaged") {
    return { problem: { detail: check.detail ?? `${directory} is damaged`, fix: check.fix ?? "install it again", ...(check.file === undefined ? {} : { file: check.file }) } };
  }
  const entry = bundleInFolder(directory, id);
  if (entry === null || entry.version === version) return { entry };
  return { problem: { detail: `plugin.json in ${directory} names version ${entry.version ?? "(none)"}, not ${version}`, fix: REINSTALL_FIX, file: "plugin.json" } };
}

/**
 * The plugin bundles installed in `cache`, each id at the one version `versions` names, every
 * version checked through `cache.check` on each `locate`.
 */
export function cacheBundles(runtime: Pick<Runtime, "cache">, cache: string, versions: Record<string, string>): CacheBundles {
  const problems = new Map<string, BundleProblem>();
  const locate = (id: string): BundleEntry | null => {
    if (!Object.hasOwn(versions, id)) return null;
    const version = versions[id] as string;
    const located = locateVersion(runtime, join(cache, "bundles", id, version), id, version);
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
