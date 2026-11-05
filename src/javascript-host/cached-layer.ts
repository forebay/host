import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { HostRefusal, REINSTALL_FIX } from "../host-refusal.js";
import { isRecord } from "../plugins/is-record.js";
import { cachedForebayLibrary, FOREBAY_LIBRARY_ID } from "../forebay-library/open.js";
import type { ForebayLibrarySource } from "../forebay-library/open.js";
import { cachedRuntime } from "../runtime/cached-runtime.js";
import type { HostLibraries } from "../runtime/cached-runtime.js";
import type { Runtime, RuntimeSource } from "../runtime/open.js";

export const LAYER_ID = "javascript-host";

/** The installed javascript-host bundle a process runs from: its cache, its version, and the runtime and koffi it loads. */
export interface CachedLayer {
  cache: string;
  version: string;
  libraries: HostLibraries;
  source: RuntimeSource;
}

function cacheOf(bundleFile: string): { cache: string; version: string } {
  const directory = dirname(bundleFile);
  const bundles = dirname(dirname(directory));
  if (basename(bundles) === "bundles") return { cache: dirname(bundles), version: basename(directory) };
  throw new HostRefusal(`${bundleFile} is not installed in a cache, so the runtime and koffi cannot be found beside it`, "run the host from <cache>/bundles/<id>/<version>/");
}

/**
 * The runtime and koffi the javascript-host's boot hint names.
 *
 * @implNote Read from the file, not through `boot.read`, because the runtime it names is the one
 * that would answer: nothing can be called before it is opened.
 */
function hintedLibraries(cache: string): HostLibraries {
  const hint = join(cache, "hosts", `${LAYER_ID}.json`);
  let libraries: unknown;
  try {
    libraries = (JSON.parse(readFileSync(hint, "utf8")) as { libraries?: unknown }).libraries;
  } catch {
    libraries = undefined;
  }
  if (isRecord(libraries) && typeof libraries.runtime === "string" && typeof libraries.koffi === "string") return { runtime: libraries.runtime, koffi: libraries.koffi };
  throw new HostRefusal(`no runtime and koffi are hinted in ${hint}`, REINSTALL_FIX);
}

export function cachedLayerOf(bundleFile: string): CachedLayer {
  const { cache, version } = cacheOf(bundleFile);
  const libraries = hintedLibraries(cache);
  return { cache, version, libraries, source: cachedRuntime(cache, libraries) };
}

/**
 * The `apps` library the javascript-host's boot hint names, read through `boot.read` once the
 * runtime the hint also names is open.
 */
export function hintedForebayLibrary(runtime: Pick<Runtime, "boot">, layer: CachedLayer): { version: string; source: ForebayLibrarySource } {
  const version = runtime.boot.read({ cache: layer.cache, hostId: LAYER_ID }).hint?.libraries[FOREBAY_LIBRARY_ID];
  if (version === undefined) throw new HostRefusal(`no ${FOREBAY_LIBRARY_ID} library is hinted for the ${LAYER_ID} in ${layer.cache}`, REINSTALL_FIX);
  return { version, source: cachedForebayLibrary(layer.cache, version) };
}
