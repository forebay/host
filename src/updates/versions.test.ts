import { describe, expect, it } from "vitest";
import type { Catalog, CatalogItem } from "../catalog/catalog.js";
import { resolveVersions } from "./versions.js";

function item(latest: string, versions: string[], kind: CatalogItem["kind"] = "plugin"): CatalogItem {
  return { kind, latest, versions: Object.fromEntries(versions.map((version) => [version, { files: {} }])) };
}

function catalog(items: Record<string, CatalogItem>): Catalog {
  return { format: 1, items };
}

describe("resolveVersions", () => {
  it("never moves a pinned id, even when the catalog has a newer latest", () => {
    const resolved = resolveVersions(catalog({ a: item("2.0.0", ["1.0.0", "2.0.0"]) }), [{ id: "a", pin: "1.0.0" }], { a: ["1.0.0", "2.0.0"] });
    expect(resolved).toEqual({ run: { a: "1.0.0" }, fetch: [] });
  });

  it("fetches a pin that is not installed and runs nothing for it this start", () => {
    const resolved = resolveVersions(catalog({ a: item("2.0.0", ["1.0.0", "2.0.0"]) }), [{ id: "a", pin: "1.0.0" }], { a: ["2.0.0"] });
    expect(resolved).toEqual({ run: {}, fetch: [{ id: "a", version: "1.0.0" }] });
  });

  it("runs the installed version of an unpinned id and fetches a newer latest, which the next resolve runs", () => {
    const listed = catalog({ a: item("2.0.0", ["1.0.0", "2.0.0"]) });
    expect(resolveVersions(listed, [{ id: "a" }], { a: ["1.0.0"] })).toEqual({ run: { a: "1.0.0" }, fetch: [{ id: "a", version: "2.0.0" }] });
    expect(resolveVersions(listed, [{ id: "a" }], { a: ["1.0.0", "2.0.0"] })).toEqual({ run: { a: "2.0.0" }, fetch: [] });
  });

  it("runs the newest installed version by semver, not by how the names sort", () => {
    const resolved = resolveVersions(catalog({}), [{ id: "a" }], { a: ["1.10.0", "1.9.0", "1.10.0-beta.1"] });
    expect(resolved.run).toEqual({ a: "1.10.0" });
  });

  it("runs the catalog's latest when it is installed, even when a newer version is installed too", () => {
    const resolved = resolveVersions(catalog({ a: item("1.0.0", ["1.0.0", "2.0.0"]) }), [{ id: "a" }], { a: ["1.0.0", "2.0.0"] });
    expect(resolved).toEqual({ run: { a: "1.0.0" }, fetch: [] });
  });

  it("fetches the latest of an enabled id with nothing installed and runs nothing for it", () => {
    expect(resolveVersions(catalog({ a: item("1.0.0", ["1.0.0"]) }), [{ id: "a" }], {})).toEqual({ run: {}, fetch: [{ id: "a", version: "1.0.0" }] });
  });

  it("fetches nothing for an id the catalog does not list or lists as something other than a plugin", () => {
    const listed = catalog({ runtime: item("1.0.0", ["1.0.0"], "library") });
    expect(resolveVersions(listed, [{ id: "runtime" }, { id: "absent" }], {})).toEqual({ run: {}, fetch: [] });
  });

  it("does not fetch a pin the catalog does not list", () => {
    expect(resolveVersions(catalog({ a: item("1.0.0", ["1.0.0"]) }), [{ id: "a", pin: "9.9.9" }], {})).toEqual({ run: {}, fetch: [] });
  });
});
