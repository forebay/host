import { join } from "node:path";
import { bundleInFolder } from "../plugins/bundle-source.js";
import type { BundleEntry, BundleSource } from "../plugins/bundle-source.js";

/** Bundles installed in the cache, each id at the one version `versions` names for this start. */
export function cacheBundleSource(cache: string, versions: Record<string, string>): BundleSource {
  const locate = (id: string): BundleEntry | null => {
    if (!Object.hasOwn(versions, id)) return null;
    return bundleInFolder(join(cache, "bundles", id, versions[id] as string), id);
  };
  return {
    list: () => Object.keys(versions).sort().flatMap((id) => locate(id) ?? []),
    locate,
  };
}
