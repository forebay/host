import { join } from "node:path";
import { readCatalogSources } from "../catalog/sources.js";
import type { CatalogSource } from "../catalog/sources.js";
import type { HostPlaces } from "../context/places.js";
import { isRecord } from "../plugins/is-record.js";
import type { Runtime } from "../runtime/open.js";

const SOURCES_KEY = "catalog.sources";

/** @implNote Never created: settings read through it come from the portable layer alone. */
const NO_HOME = "portable-layer-only";

type Layer = "application" | "portable";

function listedIn(values: Record<string, unknown>): unknown[] | undefined {
  const sources = isRecord(values.catalog) ? values.catalog.sources : undefined;
  return Array.isArray(sources) ? sources : undefined;
}

function sameSource(left: CatalogSource, right: CatalogSource): boolean {
  if (left.kind === "local" && right.kind === "local") return left.path === right.path;
  return left.kind === "https" && right.kind === "https" && left.url === right.url;
}

function isListed(entries: unknown[], source: CatalogSource): boolean {
  return readCatalogSources({ catalog: { sources: entries } }).sources.some((listed) => sameSource(listed, source));
}

class LayeredSources {
  constructor(
    private readonly runtime: Runtime,
    private readonly places: HostPlaces,
    private readonly home: string,
  ) {}

  merged(): unknown[] {
    return listedIn(this.runtime.settings.all({ home: this.home, portable: this.places.portable }).values) ?? [];
  }

  own(layer: Layer): unknown[] | undefined {
    const scope = layer === "application" ? { home: this.home } : { home: join(this.places.state, NO_HOME), portable: this.places.portable };
    return listedIn(this.runtime.settings.all(scope).values);
  }

  write(layer: Layer, entries: unknown[]): void {
    this.runtime.settings.set({ home: this.home, portable: this.places.portable, key: SOURCES_KEY, value: entries, layer });
  }

  appendTo(layer: Layer, base: unknown[], source: CatalogSource): void {
    if (!isListed(base, source)) this.write(layer, [...base, source]);
  }
}

/**
 * @implNote Layers merge a list whole, so an application list hides the portable one: a local
 * source therefore starts its application list from the merged one, and an https source is added
 * to the application list too whenever one exists.
 */
function recordOne(layers: LayeredSources, source: CatalogSource): void {
  if (isListed(layers.merged(), source)) return;
  const application = layers.own("application");
  if (source.kind === "local") {
    layers.appendTo("application", application ?? layers.merged(), source);
    return;
  }
  layers.appendTo("portable", layers.own("portable") ?? [], source);
  if (application !== undefined) layers.appendTo("application", application, source);
}

/**
 * Appends each of `sources` that `catalog.sources` does not list yet, never replacing one that is.
 *
 * @remarks A local source names a path on this machine, which the portable place never holds
 * (home-layout spec section 3), so it goes to the application layer; an https source goes to the
 * portable layer, where every application on the machine reads it.
 */
export function recordCatalogSources(runtime: Runtime, places: HostPlaces, home: string, sources: readonly CatalogSource[]): void {
  const layers = new LayeredSources(runtime, places, home);
  for (const source of sources) recordOne(layers, source);
}
