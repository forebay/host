import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleLocationOf } from "../cache/bundle-location.js";
import { newestInstalledLibrary } from "../cache/installed-library.js";

type Koffi = Record<string | symbol, unknown>;

let loaded: Koffi | undefined;

/** @implNote Spelled as weivel's `currentPlatformKey`, which this module cannot import: weivel's host imports this module as `koffi`. */
function platformKey(): string {
  return `${process.platform}-${process.arch}`;
}

function koffiDirectory(): string {
  const bundle = bundleLocationOf(fileURLToPath(import.meta.url));
  if (bundle === undefined) {
    throw new Error(`${fileURLToPath(import.meta.url)} is not installed in a cache, so koffi cannot be found beside it; run the host from <cache>/bundles/<id>/<version>/`);
  }
  const version = newestInstalledLibrary(bundle.cache, "koffi", platformKey());
  if (version === undefined) {
    throw new Error(`no koffi is installed for ${platformKey()} in ${join(bundle.cache, "libraries", "koffi")}; run the host's install command again`);
  }
  return join(bundle.cache, "libraries", "koffi", version, platformKey());
}

function koffi(): Koffi {
  loaded ??= createRequire(import.meta.url)(join(koffiDirectory(), "index.js")) as Koffi;
  return loaded;
}

/**
 * Stands in for the `koffi` package in the host bundle, loading koffi from
 * `<cache>/libraries/koffi/<version>/<platform>/` the first time any member is read.
 *
 * @implNote Lazy, because `install` runs this bundle before koffi is in the cache and fetches it
 * first; nothing reads a member until the runtime is opened. The cache is the one holding the
 * bundle itself, found from the bundle's own path, because the places are the runtime's answer
 * and the runtime needs koffi to give it.
 */
const cachedKoffi: Koffi = new Proxy({} as Koffi, { get: (_, member) => koffi()[member] });

export default cachedKoffi;
