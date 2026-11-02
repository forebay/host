import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { directoryBundles } from "./bundle-source.js";

let root: string;

function plugin(id: string, manifest: Record<string, unknown>, entry?: string): void {
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(join(root, id, "plugin.json"), JSON.stringify(manifest));
  if (entry !== undefined) writeFileSync(join(root, id, entry), "export default {};");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "host-bundles-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("directoryBundles", () => {
  it("lists every folder carrying a plugin.json, ordered by id, with its version and entry", () => {
    plugin("b", { id: "b", api: 1, version: "2.0.0", entry: "index.js" }, "index.js");
    plugin("a", { id: "a", api: 1, version: "1.0.0" });
    mkdirSync(join(root, "empty"));
    writeFileSync(join(root, "package.json"), "{}");
    expect(directoryBundles(root).list()).toEqual([
      { id: "a", version: "1.0.0", manifestPath: join(root, "a", "plugin.json"), entryPath: null },
      { id: "b", version: "2.0.0", manifestPath: join(root, "b", "plugin.json"), entryPath: join(root, "b", "index.js") },
    ]);
  });

  it("answers a null version when plugin.json declares none, rather than inventing one", () => {
    plugin("a", { id: "a", api: 1 });
    expect(directoryBundles(root).locate("a")?.version).toBeNull();
  });

  it("answers no entry path when the declared entry is not on disk", () => {
    plugin("a", { id: "a", api: 1, version: "1.0.0", entry: "index.js" });
    expect(directoryBundles(root).locate("a")?.entryPath).toBeNull();
  });

  it("locates nothing for an id with no folder, and lists nothing under a missing root", () => {
    expect(directoryBundles(root).locate("absent")).toBeNull();
    expect(directoryBundles(join(root, "nowhere")).list()).toEqual([]);
  });
});
