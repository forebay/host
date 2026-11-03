import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cacheBundleSource } from "./cache-bundle-source.js";

let cache: string;

interface Bundle {
  manifestVersion?: string;
  entry?: string;
  marked?: boolean;
}

function sha256Of(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function installed(id: string, version: string, bundle: Bundle = {}): string {
  const directory = join(cache, "bundles", id, version);
  mkdirSync(directory, { recursive: true });
  const files: Record<string, string> = { "plugin.json": JSON.stringify({ id, api: 1, version: bundle.manifestVersion ?? version, entry: "index.js" }) };
  if (bundle.entry !== undefined) files[bundle.entry] = "export default {};";
  for (const [key, content] of Object.entries(files)) writeFileSync(join(directory, key), content);
  const hashes = Object.fromEntries(Object.entries(files).map(([key, content]) => [key, sha256Of(content)]));
  if (bundle.marked !== false) writeFileSync(join(directory, ".installed.json"), JSON.stringify({ files: hashes }));
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
    installed("a", "1.0.0", { entry: "index.js" });
    const directory = installed("a", "2.0.0", { entry: "index.js" });
    const source = cacheBundleSource(cache, { a: "2.0.0" });
    expect(source.locate("a")).toEqual({
      id: "a",
      version: "2.0.0",
      manifestPath: join(directory, "plugin.json"),
      entryPath: join(directory, "index.js"),
    });
    expect(source.problems()).toEqual([]);
  });

  it("answers null for a version that is not installed and for an id it was not given", () => {
    installed("a", "1.0.0", { entry: "index.js" });
    const source = cacheBundleSource(cache, { a: "2.0.0" });
    expect(source.locate("a")).toBeNull();
    expect(source.locate("b")).toBeNull();
    expect(source.locate("constructor")).toBeNull();
    expect(source.problems()).toEqual([]);
  });

  it("answers null for a version with no completion marker, as an install that never finished", () => {
    installed("a", "1.0.0", { entry: "index.js", marked: false });
    const source = cacheBundleSource(cache, { a: "1.0.0" });
    expect(source.locate("a")).toBeNull();
    expect(source.list()).toEqual([]);
  });

  it("answers no entry path when the declared entry is missing", () => {
    installed("a", "1.0.0");
    expect(cacheBundleSource(cache, { a: "1.0.0" }).locate("a")?.entryPath).toBeNull();
  });

  it("lists every id it was given that is installed, ordered by id", () => {
    installed("b", "1.0.0", { entry: "index.js" });
    installed("a", "1.0.0", { entry: "index.js" });
    const listed = cacheBundleSource(cache, { b: "1.0.0", c: "1.0.0", a: "1.0.0" }).list();
    expect(listed.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("refuses to run a version whose stored file was corrupted, recording the problem with the file", () => {
    const directory = installed("a", "1.0.0", { entry: "index.js" });
    writeFileSync(join(directory, "index.js"), "export default {}!");
    const source = cacheBundleSource(cache, { a: "1.0.0" });
    expect(source.locate("a")).toBeNull();
    expect(source.problems()).toEqual([expect.objectContaining({ id: "a", version: "1.0.0", file: "index.js" })]);
    expect(source.problems()[0]?.detail).toContain("index.js");
  });

  it("refuses to run a version whose stored file is missing", () => {
    const directory = installed("a", "1.0.0", { entry: "index.js" });
    rmSync(join(directory, "index.js"));
    const source = cacheBundleSource(cache, { a: "1.0.0" });
    expect(source.locate("a")).toBeNull();
    expect(source.problems()).toEqual([expect.objectContaining({ id: "a", file: "index.js" })]);
  });

  it("refuses a version whose plugin.json names another version", () => {
    installed("a", "1.0.0", { entry: "index.js", manifestVersion: "1.0.1" });
    const source = cacheBundleSource(cache, { a: "1.0.0" });
    expect(source.locate("a")).toBeNull();
    expect(source.problems()).toEqual([expect.objectContaining({ id: "a", version: "1.0.0" })]);
    expect(source.problems()[0]?.detail).toContain("1.0.1");
  });

  it("refuses a version whose completion marker is not readable", () => {
    const directory = installed("a", "1.0.0", { entry: "index.js" });
    writeFileSync(join(directory, ".installed.json"), "{");
    const source = cacheBundleSource(cache, { a: "1.0.0" });
    expect(source.locate("a")).toBeNull();
    expect(source.problems()).toHaveLength(1);
  });

  it("refuses a marker that names a file outside its version directory", () => {
    const directory = installed("a", "1.0.0", { entry: "index.js" });
    writeFileSync(join(directory, ".installed.json"), JSON.stringify({ files: { "../../outside.js": "0".repeat(64) } }));
    const source = cacheBundleSource(cache, { a: "1.0.0" });
    expect(source.locate("a")).toBeNull();
    expect(source.problems()).toHaveLength(1);
  });
});
