import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cacheBundleSource } from "./cache-bundle-source.js";

let cache: string;

function installed(id: string, version: string, entry?: string): string {
  const directory = join(cache, "bundles", id, version);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "plugin.json"), JSON.stringify({ id, api: 1, version, entry: "index.js" }));
  if (entry !== undefined) writeFileSync(join(directory, entry), "export default {};");
  return directory;
}

beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), "host-cache-source-"));
});

afterEach(() => {
  rmSync(cache, { recursive: true, force: true });
});

describe("cacheBundleSource", () => {
  it("locates the version it was given, with its manifest and entry", () => {
    installed("a", "1.0.0", "index.js");
    const directory = installed("a", "2.0.0", "index.js");
    expect(cacheBundleSource(cache, { a: "2.0.0" }).locate("a")).toEqual({
      id: "a",
      version: "2.0.0",
      manifestPath: join(directory, "plugin.json"),
      entryPath: join(directory, "index.js"),
    });
  });

  it("answers null for a version that is not installed and for an id it was not given", () => {
    installed("a", "1.0.0", "index.js");
    const source = cacheBundleSource(cache, { a: "2.0.0" });
    expect(source.locate("a")).toBeNull();
    expect(source.locate("b")).toBeNull();
    expect(source.locate("constructor")).toBeNull();
  });

  it("answers no entry path when the declared entry is missing", () => {
    installed("a", "1.0.0");
    expect(cacheBundleSource(cache, { a: "1.0.0" }).locate("a")?.entryPath).toBeNull();
  });

  it("lists every id it was given that is installed, ordered by id", () => {
    installed("b", "1.0.0", "index.js");
    installed("a", "1.0.0", "index.js");
    const listed = cacheBundleSource(cache, { b: "1.0.0", c: "1.0.0", a: "1.0.0" }).list();
    expect(listed.map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});
