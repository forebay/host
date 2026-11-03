import { basename, dirname } from "node:path";

/** Where an installed bundle sits: the cache holding it, its id and its version. */
export interface BundleLocation {
  cache: string;
  id: string;
  version: string;
  directory: string;
}

/** The cache, id and version of the bundle whose file is `bundleFile`, or undefined when it is not at `<cache>/bundles/<id>/<version>/`. */
export function bundleLocationOf(bundleFile: string): BundleLocation | undefined {
  const directory = dirname(bundleFile);
  const idDirectory = dirname(directory);
  const bundles = dirname(idDirectory);
  if (basename(bundles) !== "bundles") return undefined;
  return { cache: dirname(bundles), id: basename(idDirectory), version: basename(directory), directory };
}
