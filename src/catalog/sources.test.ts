import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPOSITORY_ROOT } from "../__fixtures__/context.js";
import { openRuntime, siblingRuntime } from "../runtime/open.js";
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
    const settings = { catalog: { sources: [{ kind: "local", path: "C:/out" }, { kind: "https", url: "https://e.com/index.json" }] } };
    expect(catalogSources(settings)).toEqual([
      { kind: "local", path: "C:/out" },
      { kind: "https", url: "https://e.com/index.json" },
    ]);
  });

  it("reads the sources a real settings round trip stores under catalog.sources", () => {
    const base = mkdtempSync(join(tmpdir(), "host-sources-"));
    const runtime = openRuntime(siblingRuntime(REPOSITORY_ROOT));
    try {
      const environment = { SPISOR_HOME: join(base, "portable"), SPISOR_STATE: join(base, "state"), SPISOR_CACHE: join(base, "cache"), SPISOR_SECRETS: join(base, "secrets") };
      const places = runtime.places.resolve({ home: join(base, "user"), environment });
      const scope = { home: join(base, "home"), portable: places.portable };
      const sources = [{ kind: "https", url: "https://e.com/index.json" }];
      runtime.settings.set({ ...scope, key: "catalog.sources", value: sources, layer: "portable" });
      expect(catalogSources(runtime.settings.all(scope).values)).toEqual(sources);
    } finally {
      runtime.close();
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("is empty without the setting", () => {
    expect(catalogSources({})).toEqual([]);
  });

  it("skips an unknown kind and reports it", () => {
    const settings = { catalog: { sources: [{ kind: "ftp", host: "x" }, { kind: "local", path: "p" }, "junk", { kind: "https" }] } };
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

  it("treats an inherited object member name as absent", () => {
    const merged = mergeCatalogs([{ source: first, catalog: catalog({ constructor: item("1") }) }]);
    expect(merged.shadowed).toEqual([]);
    expect(Object.hasOwn(merged.catalog.items, "constructor")).toBe(true);
  });

  it("merges nothing into an empty catalog", () => {
    expect(mergeCatalogs([])).toEqual({ catalog: { format: 1, items: {} }, shadowed: [] });
  });
});
