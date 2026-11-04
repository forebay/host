import { join } from "node:path";
import { currentPlatformKey } from "@weivel/typescript/host";
import { CacheRefusal } from "../cache/cache-refusal.js";
import { checkInstalled } from "../cache/install-marker.js";
import type { Catalog } from "../catalog/catalog.js";
import type { HostLibraries } from "../runtime/cached-runtime.js";
import type { RuntimeSource } from "../runtime/open.js";
import { readHostReferences } from "../updates/references.js";
import type { HostReferences } from "../updates/references.js";
import { bootLibraries, hostLibrariesOf, KOFFI_ID, recordBootLibraries, resolveHostLibraries, RUNTIME_ID, verifiedRuntimeSource } from "./host-libraries.js";

/** The runtime and koffi a start loads from the cache, verified, and the source to open the runtime from. */
export interface CacheBoot {
  libraries: HostLibraries;
  runtime: RuntimeSource;
}

/** What a start resolves its next libraries from, and what it runs now beside the libraries. */
export interface LibraryResolution {
  cache: string;
  state: string;
  hostId: string;
  catalog: Catalog;
  /** The host's merged settings, read through the runtime `loaded` names. */
  settings: Record<string, unknown>;
  loaded: HostLibraries;
  /** The other versions this start runs from the cache, such as the host's own bundle and its plugins. */
  running: Record<string, string>;
  platformKey?: string;
}

/**
 * The runtime and koffi a start of `hostId` loads from `cache`, every file re-hashed first.
 *
 * @remarks Refused when either is missing or damaged, with the fix to install again.
 */
export function bootFromCache(cache: string, hostId: string): CacheBoot {
  const platformKey = currentPlatformKey();
  const libraries = bootLibraries(cache, hostId, platformKey);
  if (libraries === undefined) throw new CacheRefusal(`no runtime and koffi are both installed for ${platformKey} in ${cache}`, "run forebay-host install --catalog <path or url> again");
  return { libraries, runtime: verifiedRuntimeSource(cache, libraries, platformKey) };
}

function changedFrom(loaded: HostLibraries, resolved: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(resolved).filter(([id, version]) => loaded[id as keyof HostLibraries] !== version));
}

/** @implNote A boot hint naming a version not yet installed would refuse every command, so a scheduled version is hinted only once it is installed intact. */
function hintedHostVersion(cache: string, hostId: string, scheduled: string | undefined, running: string | undefined): string | undefined {
  if (scheduled !== undefined && checkInstalled(join(cache, "bundles", hostId, scheduled)).kind === "intact") return scheduled;
  return running;
}

/**
 * Resolves the runtime and koffi the next start loads, records them for it with the host bundle
 * version it runs (the one scheduled once installed, else the one running), and answers the
 * references that keep both those and what runs now from any sweep, beside what the host already
 * scheduled for its next start.
 */
export function hostLibraryReferences(resolution: LibraryResolution): HostReferences {
  const { cache, state, hostId, loaded } = resolution;
  const resolved = resolveHostLibraries(resolution.catalog, resolution.settings, cache, resolution.platformKey ?? currentPlatformKey());
  const scheduled = { ...readHostReferences(state, hostId).next, ...changedFrom(loaded, resolved) };
  const next = hostLibrariesOf(resolved);
  if (next !== undefined) recordBootLibraries(cache, hostId, next, hintedHostVersion(cache, hostId, scheduled[hostId], resolution.running[hostId]));
  return { run: { ...resolution.running, [RUNTIME_ID]: loaded.runtime, [KOFFI_ID]: loaded.koffi }, next: scheduled };
}

export type { HostLibraries, HostReferences };
