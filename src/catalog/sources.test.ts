import { describe, expect, it } from "vitest";
import type { Catalog, CatalogItem } from "./catalog.js";
import { catalogSources, mergeCatalogs, readCatalogSources } from "./sources.js";
import type { CatalogSource } from "./sources.js";

const item = (latest: string): CatalogItem => ({
  kind: "plugin",
  latest,
  versions: { [latest]: { files: { "p.js": { url: "https://e.com/p.js", sha256: "b".repeat(64), size: 1 } } } },
});

const catalog = (items: Record<string, CatalogItem>): Catalog => ({ format: 1, items });

describe("catalogSources", () => {
  it("reads local and https sources in order", () => {
    const settings = { "catalog.sources": [{ kind: "local", path: "C:/out" }, { kind: "https", url: "https://e.com/index.json" }] };
    expect(catalogSources(settings)).toEqual([
      { kind: "local", path: "C:/out" },
      { kind: "https", url: "https://e.com/index.json" },
    ]);
  });

  it("is empty without the setting", () => {
    expect(catalogSources({})).toEqual([]);
  });

  it("skips an unknown kind and reports it", () => {
    const settings = { "catalog.sources": [{ kind: "ftp", host: "x" }, { kind: "local", path: "p" }, "junk", { kind: "https" }] };
    const read = readCatalogSources(settings);
    expect(read.sources).toEqual([{ kind: "local", path: "p" }]);
    expect(read.skipped.map((entry) => entry.index)).toEqual([0, 2, 3]);
    expect(read.skipped[0]?.detail).toContain("ftp");
  });
});

describe("mergeCatalogs", () => {
  const first: CatalogSource = { kind: "local", path: "a" };
  const second: CatalogSource = { kind: "https", url: "https://e.com/i.json" };

  it("keeps the earlier source's item and reports the later one shadowed", () => {
    const merged = mergeCatalogs([
      { source: first, catalog: catalog({ x: item("1"), y: item("1") }) },
      { source: second, catalog: catalog({ x: item("2"), z: item("2") }) },
    ]);
    expect(merged.catalog.items.x?.latest).toBe("1");
    expect(Object.keys(merged.catalog.items).sort()).toEqual(["x", "y", "z"]);
    expect(merged.shadowed).toEqual([{ id: "x", source: second }]);
  });

  it("merges nothing into an empty catalog", () => {
    expect(mergeCatalogs([])).toEqual({ catalog: { format: 1, items: {} }, shadowed: [] });
  });
});
