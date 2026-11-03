import type { Catalog, CatalogItem } from "./catalog.js";

export type CatalogSource = { kind: "local"; path: string } | { kind: "https"; url: string };

export interface SkippedSource {
  index: number;
  detail: string;
}

export interface CatalogSourceReading {
  sources: CatalogSource[];
  skipped: SkippedSource[];
}

export interface MergedCatalog {
  catalog: Catalog;
  shadowed: Array<{ id: string; source: CatalogSource }>;
}

const SETTING = "catalog.sources";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sourceOf(entry: unknown): CatalogSource | string {
  if (!isRecord(entry)) return "a catalog source must be an object with a kind";
  if (entry.kind === "local" && typeof entry.path === "string") return { kind: "local", path: entry.path };
  if (entry.kind === "https" && typeof entry.url === "string") return { kind: "https", url: entry.url };
  return `unknown or incomplete catalog source kind ${JSON.stringify(entry.kind)}`;
}

export function readCatalogSources(settings: Record<string, unknown>): CatalogSourceReading {
  const configured = settings[SETTING];
  const entries = Array.isArray(configured) ? configured : [];
  const reading: CatalogSourceReading = { sources: [], skipped: [] };
  entries.forEach((entry, index) => {
    const source = sourceOf(entry);
    if (typeof source === "string") reading.skipped.push({ index, detail: source });
    else reading.sources.push(source);
  });
  return reading;
}

export function catalogSources(settings: Record<string, unknown>): CatalogSource[] {
  return readCatalogSources(settings).sources;
}

export function mergeCatalogs(catalogs: Array<{ source: CatalogSource; catalog: Catalog }>): MergedCatalog {
  const merged: MergedCatalog = { catalog: { format: 1, items: Object.create(null) as Record<string, CatalogItem> }, shadowed: [] };
  for (const { source, catalog } of catalogs) {
    for (const [id, item] of Object.entries(catalog.items)) {
      if (Object.hasOwn(merged.catalog.items, id)) merged.shadowed.push({ id, source });
      else merged.catalog.items[id] = item;
    }
  }
  return merged;
}
