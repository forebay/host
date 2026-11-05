import type { Runtime } from "../runtime/open.js";
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

/**
 * The plugin bundles installed in `cache`, each id at the one version `versions` names, as
 * `cache.locate` finds them on each `list` and `locate`.
 */
export function cacheBundles(runtime: Pick<Runtime, "cache">, cache: string, versions: Record<string, string>): CacheBundles {
  const problems = new Map<string, BundleProblem>();
  const located = (plugins: Record<string, string>): BundleEntry[] => {
    const answer = runtime.cache.locate({ cache, plugins });
    for (const id of Object.keys(plugins)) problems.delete(id);
    for (const problem of answer.problems) problems.set(problem.id, problem);
    return answer.located.map(({ id, version, manifest, entry }) => ({ id, version, manifestPath: manifest, entryPath: entry ?? null }));
  };
  return {
    list: () => located(versions),
    locate: (id) => (Object.hasOwn(versions, id) ? (located({ [id]: versions[id] as string })[0] ?? null) : null),
    problems: () => [...problems.values()],
  };
}
