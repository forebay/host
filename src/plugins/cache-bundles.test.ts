import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { REPOSITORY_ROOT } from "../__fixtures__/context.js";
import { openRuntime, siblingRuntime } from "../runtime/open.js";
import { cacheBundles } from "./cache-bundles.js";

interface Bundle {
  manifestVersion?: string;
  entry?: string;
}

const RUNTIME = openRuntime(siblingRuntime(REPOSITORY_ROOT));

let cache: string;

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
  writeFileSync(join(directory, ".installed.json"), JSON.stringify({ files: hashes }));
  return directory;
}

beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), "host-cache-bundles-"));
});

afterEach(() => {
  rmSync(cache, { recursive: true, force: true });
});

afterAll(() => RUNTIME.close());

describe("cacheBundles", () => {
  it("answers no entry path when the declared entry is missing", () => {
    installed("a", "1.0.0");
    expect(cacheBundles(RUNTIME, cache, { a: "1.0.0" }).locate("a")?.entryPath).toBeNull();
  });

  it("lists every id it was given that is installed, ordered by id", () => {
    installed("b", "1.0.0", { entry: "index.js" });
    installed("a", "1.0.0", { entry: "index.js" });
    const listed = cacheBundles(RUNTIME, cache, { b: "1.0.0", c: "1.0.0", a: "1.0.0" }).list();
    expect(listed.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("refuses a version whose plugin.json names another version", () => {
    installed("a", "1.0.0", { entry: "index.js", manifestVersion: "1.0.1" });
    const source = cacheBundles(RUNTIME, cache, { a: "1.0.0" });
    expect(source.locate("a")).toBeNull();
    expect(source.problems()).toEqual([expect.objectContaining({ id: "a", version: "1.0.0" })]);
    expect(source.problems()[0]?.detail).toContain("1.0.1");
  });

  it("reports a version the cache check finds damaged, naming the file", () => {
    const directory = installed("a", "1.0.0", { entry: "index.js" });
    writeFileSync(join(directory, "index.js"), "export default {}!");
    const source = cacheBundles(RUNTIME, cache, { a: "1.0.0" });
    expect(source.locate("a")).toBeNull();
    expect(source.problems()).toEqual([expect.objectContaining({ id: "a", version: "1.0.0", file: "index.js" })]);
  });
});
