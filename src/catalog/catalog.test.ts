import { describe, expect, it } from "vitest";
import { readCatalog } from "./catalog.js";
import type { Catalog, CatalogRefusal } from "./catalog.js";

const HASH = "a".repeat(64);
const file = (url: string) => ({ url, sha256: HASH, size: 3 });

const index = (item: unknown) => JSON.stringify({ format: 1, items: { thing: item } });

const pluginItem = {
  kind: "plugin",
  latest: "1.0.0",
  versions: { "1.0.0": { files: { "plugin.js": file("plugin.js") }, packages: { npm: { name: "x" } } } },
};

function refusal(result: Catalog | CatalogRefusal): CatalogRefusal {
  if (!("detail" in result)) throw new Error("expected a refusal");
  return result;
}

describe("readCatalog", () => {
  it("reads an index of each kind", () => {
    const text = JSON.stringify({
      format: 1,
      items: {
        a: pluginItem,
        b: { kind: "host", latest: "2", versions: { "2": { platforms: { "win32-x64": { files: { "bin/host.exe": file("h.exe") } } } } } },
        c: { kind: "library", latest: "3", versions: { "3": { files: { "lib.js": file("l.js") } } } },
      },
    });
    const result = readCatalog(text, "https://example.com/catalog/index.json") as Catalog;
    expect(Object.keys(result.items)).toEqual(["a", "b", "c"]);
    expect(result.items.b?.kind).toBe("host");
  });

  it("refuses a file key with a .. segment, naming its path", () => {
    const bad = { ...pluginItem, versions: { "1.0.0": { files: { "a/../b.js": file("x") } } } };
    const result = refusal(readCatalog(index(bad), "https://e.com/i.json"));
    expect(result.path).toContain("/items/thing/versions/1.0.0/files");
    expect(result.fix).not.toBe("");
  });

  it("refuses a leading slash and a backslash in a file key", () => {
    for (const key of ["/abs.js", "a\\b.js", ".."]) {
      const bad = { ...pluginItem, versions: { "1.0.0": { files: { [key]: file("x") } } } };
      expect("detail" in readCatalog(index(bad), "https://e.com/i.json")).toBe(true);
    }
  });

  it("refuses a bad hash, naming its path", () => {
    const bad = { ...pluginItem, versions: { "1.0.0": { files: { "p.js": { url: "p", sha256: HASH + "\n", size: 1 } } } } };
    const result = refusal(readCatalog(index(bad), "https://e.com/i.json"));
    expect(result.path).toContain("sha256");
  });

  it("refuses an unknown kind, naming its path", () => {
    const result = refusal(readCatalog(index({ ...pluginItem, kind: "gadget" }), "https://e.com/i.json"));
    expect(result.path).toBe("/items/thing/kind");
  });

  it("refuses an item with neither files nor platforms", () => {
    const bad = { ...pluginItem, versions: { "1.0.0": { packages: {} } } };
    expect("detail" in readCatalog(index(bad), "https://e.com/i.json")).toBe(true);
  });

  it("refuses a latest that names no version", () => {
    const result = refusal(readCatalog(index({ ...pluginItem, latest: "9.9.9" }), "https://e.com/i.json"));
    expect(result.path).toBe("/items/thing/latest");
  });

  it("refuses text that is not JSON", () => {
    expect(refusal(readCatalog("{nope", "https://e.com/i.json")).detail).toMatch(/JSON/);
  });

  it("resolves a relative url against an https origin", () => {
    const result = readCatalog(index(pluginItem), "https://example.com/catalog/index.json") as Catalog;
    expect(result.items.thing?.versions["1.0.0"]?.files?.["plugin.js"]?.url).toBe("https://example.com/catalog/plugin.js");
  });

  it("resolves a relative url against a file origin", () => {
    const result = readCatalog(index(pluginItem), "file:///C:/builds/index.json") as Catalog;
    expect(result.items.thing?.versions["1.0.0"]?.files?.["plugin.js"]?.url).toBe("file:///C:/builds/plugin.js");
  });

  it("leaves an absolute url alone", () => {
    const item = { ...pluginItem, versions: { "1.0.0": { files: { "p.js": file("https://cdn.example.com/p.js") } } } };
    const result = readCatalog(index(item), "https://example.com/i.json") as Catalog;
    expect(result.items.thing?.versions["1.0.0"]?.files?.["p.js"]?.url).toBe("https://cdn.example.com/p.js");
  });

  it("accepts members the schema does not know", () => {
    const item = { ...pluginItem, extra: { deep: true }, versions: { "1.0.0": { extra: 1, files: { "p.js": { ...file("p"), mirror: "m" } } } } };
    expect("detail" in readCatalog(JSON.stringify({ format: 1, future: true, items: { thing: item } }), "https://e.com/i.json")).toBe(false);
  });
});
