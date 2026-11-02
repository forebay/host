import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { directoryBundles } from "./bundle-source.js";
import { scanOf } from "./scan.js";

let root: string;

function plugin(folder: string, manifest: unknown): void {
  mkdirSync(join(root, folder), { recursive: true });
  writeFileSync(join(root, folder, "plugin.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
}

function scanned(ids: string[], wellKnown: string[] = []) {
  const source = directoryBundles(root);
  return scanOf(ids.map((id) => source.locate(id)!), wellKnown);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "host-scan-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("scanOf", () => {
  it("loads a valid manifest with the entry the source located", () => {
    plugin("a", { id: "a", api: 1, version: "1.0.0" });
    const scan = scanned(["a"]);
    expect(scan.failed).toEqual([]);
    expect(scan.loaded).toEqual([{ manifest: { id: "a", api: 1, version: "1.0.0" }, manifestPath: join(root, "a", "plugin.json"), entryPath: null }]);
  });

  it("fails a manifest the engine's validator refuses, naming the plugin and the fix", () => {
    plugin("a", { id: "a", api: 1, version: "1.0.0", services: { provides: ["demo:greeting"] } });
    const scan = scanned(["a"]);
    expect(scan.loaded).toEqual([]);
    expect(scan.failed).toHaveLength(1);
    expect(scan.failed[0]).toMatchObject({ pluginId: "a", fix: 'rename it to "a:<name>"' });
  });

  it("accepts a bare service id the host names as well known", () => {
    plugin("a", { id: "a", api: 1, version: "1.0.0", services: { provides: ["demo:greeting"] } });
    expect(scanned(["a"], ["demo:greeting"]).failed).toEqual([]);
  });

  it("fails a bundle that declares no version, naming the plugin and the fix", () => {
    plugin("a", { id: "a", api: 1 });
    const scan = scanned(["a"]);
    expect(scan.loaded).toEqual([]);
    expect(scan.failed).toHaveLength(1);
    expect(scan.failed[0]).toMatchObject({ pluginId: "a", fix: 'declare a "version" in plugin.json' });
  });

  it("fails unreadable JSON and a manifest whose id is not its folder", () => {
    plugin("a", "{ not json");
    plugin("b", { id: "other", api: 1, version: "1.0.0" });
    const scan = scanned(["a", "b"]);
    expect(scan.loaded).toEqual([]);
    expect(scan.failed.map((failure) => failure.pluginId)).toEqual(["a", "b"]);
  });
});
