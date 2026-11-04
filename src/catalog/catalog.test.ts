import { describe, expect, it } from "vitest";
import { readCatalog } from "./catalog.js";
import type { Catalog, CatalogRefusal } from "./catalog.js";

const HASH = "a".repeat(64);
const ORIGIN = "https://example.com/catalog/index.json";
const file = (url: string) => ({ url, sha256: HASH, size: 3 });

const index = (item: unknown, id = "thing") => JSON.stringify({ format: 1, items: { [id]: item } });

const pluginItem = {
  kind: "plugin",
  latest: "1.0.0",
  versions: { "1.0.0": { files: { "plugin.js": file("plugin.js") }, packages: { npm: { name: "x" } } } },
};

const withFiles = (files: Record<string, unknown>) => ({ ...pluginItem, versions: { "1.0.0": { files } } });

function catalogOf(text: string, origin = ORIGIN): Catalog {
  const result = readCatalog(text, origin);
  if (!result.ok) throw new Error(`expected a catalog, refused: ${result.refusal.detail}`);
  return result.catalog;
}

function refusalOf(text: string, origin = ORIGIN): CatalogRefusal {
  const result = readCatalog(text, origin);
  if (result.ok) throw new Error("expected a refusal");
  return result.refusal;
}

describe("readCatalog", () => {
  it("reads an index of each kind", () => {
    const text = JSON.stringify({
      format: 1,
      items: {
        a: pluginItem,
        b: { kind: "host", latest: "2.0.0", versions: { "2.0.0": { platforms: { "win32-x64": { files: { "bin/host.exe": file("h.exe") } } } } } },
        c: { kind: "library", latest: "3.0.0-rc.1+build.5", versions: { "3.0.0-rc.1+build.5": { files: { "lib.js": file("l.js") } } } },
      },
    });
    const catalog = catalogOf(text);
    expect(Object.keys(catalog.items)).toEqual(["a", "b", "c"]);
    expect(catalog.items.b?.kind).toBe("host");
  });

  describe("application", () => {
    const application = {
      id: "claude-code",
      label: "Claude Code",
      binary: "claude",
      home: { candidates: ["~/.claude"] },
      packages: { npm: "@anthropic-ai/claude-code" },
    };
    const hostItem = { kind: "host", latest: "1.0.0", versions: pluginItem.versions, application };

    it("reads an application on a host item", () => {
      expect(catalogOf(index(hostItem)).items.thing?.application).toEqual(application);
    });

    it("refuses an application on a plugin item", () => {
      const refusal = refusalOf(index({ ...hostItem, kind: "plugin" }));
      expect(refusal.path).toContain("/items/thing");
    });

    it("refuses a binary that is a path, and package options that are not an object", () => {
      expect(refusalOf(index({ ...hostItem, application: { ...application, binary: "../x" } })).path).toBe("/items/thing/application/binary");
      const options = { ...application, packages: { brew: { name: "x", options: "y" } } };
      expect(refusalOf(index({ ...hostItem, application: options })).path).toContain("/application/packages/brew");
    });

    it("reads a home with an xdgSubdir, and refuses one that is a path", () => {
      const xdgApplication = { ...application, home: { candidates: ["~/.config/opencode"], xdgSubdir: "opencode" } };
      expect(catalogOf(index({ ...hostItem, application: xdgApplication })).items.thing?.application).toEqual(xdgApplication);
      const pathSubdir = { ...application, home: { candidates: ["~/.config/opencode"], xdgSubdir: "../opencode" } };
      expect(refusalOf(index({ ...hostItem, application: pathSubdir })).path).toBe("/items/thing/application/home/xdgSubdir");
    });

    it("refuses an application with no binary, naming its path", () => {
      const { binary: _binary, ...withoutBinary } = application;
      expect(refusalOf(index({ ...hostItem, application: withoutBinary })).path).toBe("/items/thing/application/binary");
    });
  });

  it("refuses a file key with a .. segment, naming its path", () => {
    const refusal = refusalOf(index(withFiles({ "a/../b.js": file("x") })));
    expect(refusal.path).toContain("/items/thing/versions/1.0.0/files");
    expect(refusal.fix).not.toBe("");
  });

  it.each([
    ["a leading slash", "/abs.js"],
    ["a backslash", "a\\b.js"],
    ["a bare ..", ".."],
    ["a bare .", "."],
    ["a . segment", "a/./b.js"],
    ["a drive prefix", "C:evil.js"],
    ["a drive path", "C:/evil.js"],
    ["any colon", "a:b.js"],
    ["an empty segment", "a//b.js"],
    ["a trailing slash", "a/b/"],
    ["a segment ending in a dot", "a./b.js"],
    ["a segment ending in a space", "a /b.js"],
    ["a file name ending in a dot", "b.js."],
    ["an empty key", ""],
  ])("refuses a file key with %s", (_name, key) => {
    expect(readCatalog(index(withFiles({ [key]: file("x") })), ORIGIN).ok).toBe(false);
  });

  it("accepts a nested file key and dotted names", () => {
    expect(readCatalog(index(withFiles({ "bin/.hidden/a.b.js": file("x") })), ORIGIN).ok).toBe(true);
  });

  it("refuses a bad hash, naming its path", () => {
    const refusal = refusalOf(index(withFiles({ "p.js": { url: "p", sha256: HASH + "\n", size: 1 } })));
    expect(refusal.path).toContain("sha256");
  });

  it("refuses an unknown kind, naming its path", () => {
    expect(refusalOf(index({ ...pluginItem, kind: "gadget" })).path).toBe("/items/thing/kind");
  });

  it("refuses a version with neither files nor platforms, with a fix naming both", () => {
    const refusal = refusalOf(index({ ...pluginItem, versions: { "1.0.0": { packages: {} } } }));
    expect(refusal.fix).toBe("list files, platforms, or both");
  });

  it("refuses a latest that names no version", () => {
    expect(refusalOf(index({ ...pluginItem, latest: "9.9.9" })).path).toBe("/items/thing/latest");
  });

  it("refuses a latest that is an inherited object member name", () => {
    expect(readCatalog(index({ ...pluginItem, latest: "constructor" }), ORIGIN).ok).toBe(false);
  });

  it.each(["..", "Upper", "a--b", "con", "__proto__", "-a"])("refuses the item id %s", (id) => {
    expect(readCatalog(index(pluginItem, id), ORIGIN).ok).toBe(false);
  });

  it.each(["..", "1.0", "1.0.0..1", "v1.0.0", "constructor", "1.0.0/../x", "1.0.0-rc.", "1.0.0+build."])("refuses the version %s", (version) => {
    const item = { ...pluginItem, latest: version, versions: { [version]: { files: { "p.js": file("p") } } } };
    expect(readCatalog(index(item), ORIGIN).ok).toBe(false);
  });

  it("refuses a version key that is not semver-shaped even when latest is", () => {
    const item = { ...pluginItem, versions: { "1.0.0": { files: { "p.js": file("p") } }, "..": { files: { "p.js": file("p") } } } };
    expect(readCatalog(index(item), ORIGIN).ok).toBe(false);
  });

  it("reads an index that starts with a UTF-8 byte order mark", () => {
    expect(Object.keys(catalogOf(`\uFEFF${index(pluginItem)}`).items)).toEqual(["thing"]);
  });

  it("refuses two file keys that differ only by case, naming both", () => {
    const refusal = refusalOf(index(withFiles({ "A.js": file("a"), "a.js": file("b") })));
    expect(refusal.detail).toContain("A.js");
    expect(refusal.detail).toContain("a.js");
    expect(refusal.path).toBe("/items/thing/versions/1.0.0");
  });

  it("refuses a platform file key that differs only by case from a file listed for every platform", () => {
    const item = { kind: "library", latest: "1.0.0", versions: { "1.0.0": { files: { "Lib/x.js": file("a") }, platforms: { "linux-x64": { files: { "lib/X.js": file("b") } } } } } };
    expect(refusalOf(index(item)).detail).toContain("lib/X.js");
  });

  it("accepts keys that differ only by case on different platforms", () => {
    const item = { kind: "library", latest: "1.0.0", versions: { "1.0.0": { platforms: { "linux-x64": { files: { "A.js": file("a") } }, "win32-x64": { files: { "a.js": file("b") } } } } } };
    expect(readCatalog(index(item), ORIGIN).ok).toBe(true);
  });

  it("refuses text that is not JSON", () => {
    expect(refusalOf("{nope").detail).toMatch(/JSON/);
  });

  it("reads an index carrying top-level detail and fix members as valid", () => {
    const text = JSON.stringify({ format: 1, detail: "note", fix: "note", items: { thing: pluginItem } });
    expect(readCatalog(text, ORIGIN).ok).toBe(true);
  });

  it("resolves a relative url against an https origin", () => {
    expect(catalogOf(index(pluginItem)).items.thing?.versions["1.0.0"]?.files?.["plugin.js"]?.url).toBe(
      "https://example.com/catalog/plugin.js",
    );
  });

  it("resolves a relative url against a file origin", () => {
    const catalog = catalogOf(index(pluginItem), "file:///C:/builds/index.json");
    expect(catalog.items.thing?.versions["1.0.0"]?.files?.["plugin.js"]?.url).toBe("file:///C:/builds/plugin.js");
  });

  it("leaves an absolute https url alone under an https origin", () => {
    const catalog = catalogOf(index(withFiles({ "p.js": file("https://cdn.example.com/p.js") })));
    expect(catalog.items.thing?.versions["1.0.0"]?.files?.["p.js"]?.url).toBe("https://cdn.example.com/p.js");
  });

  it("accepts a file url inside a subdirectory of the index's directory", () => {
    expect(readCatalog(index(withFiles({ "p.js": file("sub/dir/p.js") })), "file:///C:/builds/index.json").ok).toBe(true);
  });

  it("refuses a url that climbs out of a file origin's directory", () => {
    expect(readCatalog(index(withFiles({ "p.js": file("../../x") })), "file:///C:/builds/out/index.json").ok).toBe(false);
  });

  it("refuses an absolute file url outside the index's directory", () => {
    expect(readCatalog(index(withFiles({ "p.js": file("file:///C:/other/x.js") })), "file:///C:/builds/index.json").ok).toBe(false);
  });

  it("refuses a percent-encoded climb out of a file origin's directory", () => {
    expect(readCatalog(index(withFiles({ "p.js": file("%2e%2e/x.js") })), "file:///C:/builds/out/index.json").ok).toBe(false);
    expect(readCatalog(index(withFiles({ "p.js": file("%2e%2e/%2e%2e/x.js") })), "file:///C:/builds/out/index.json").ok).toBe(false);
  });

  it("does not take a sibling directory sharing the index directory's name as a prefix", () => {
    expect(readCatalog(index(withFiles({ "p.js": file("file:///a/bc/x") })), "file:///a/b/index.json").ok).toBe(false);
    expect(readCatalog(index(withFiles({ "p.js": file("file:///a/b/x") })), "file:///a/b/index.json").ok).toBe(true);
  });

  it("refuses a UNC file url", () => {
    expect(readCatalog(index(withFiles({ "p.js": file("file://host/share/x.js") })), "file://host/share/index.json").ok).toBe(false);
    expect(readCatalog(index(withFiles({ "p.js": file("file://host/share/x.js") })), "file:///C:/builds/index.json").ok).toBe(false);
  });

  it("refuses an http url under an https origin", () => {
    expect(readCatalog(index(withFiles({ "p.js": file("http://example.com/p.js") })), ORIGIN).ok).toBe(false);
  });

  it("refuses a file url under an https origin and an https url under a file origin", () => {
    expect(readCatalog(index(withFiles({ "p.js": file("file:///C:/x.js") })), ORIGIN).ok).toBe(false);
    expect(readCatalog(index(withFiles({ "p.js": file("https://example.com/p.js") })), "file:///C:/builds/index.json").ok).toBe(false);
  });

  it.each(["data:text/plain,x", "ftp://example.com/p.js", "javascript:alert(1)"])("refuses the url %s", (url) => {
    expect(readCatalog(index(withFiles({ "p.js": file(url) })), ORIGIN).ok).toBe(false);
  });

  it("refuses an origin that is neither https nor file", () => {
    expect(readCatalog(index(pluginItem), "http://example.com/index.json").ok).toBe(false);
  });

  it("checks platform file urls too", () => {
    const item = { kind: "host", latest: "1.0.0", versions: { "1.0.0": { platforms: { linux: { files: { "h": file("http://x/h") } } } } } };
    expect(readCatalog(index(item), ORIGIN).ok).toBe(false);
  });

  it("accepts members the schema does not know", () => {
    const item = { ...pluginItem, extra: { deep: true }, versions: { "1.0.0": { extra: 1, files: { "p.js": { ...file("p"), mirror: "m" } } } } };
    expect(readCatalog(JSON.stringify({ format: 1, future: true, items: { thing: item } }), ORIGIN).ok).toBe(true);
  });
});
