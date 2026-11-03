import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordReferences } from "./references.js";
import { sweepCache } from "./sweep.js";

let base: string;
let cache: string;
let state: string;

function installed(id: string, version: string, marked = true): string {
  const directory = join(cache, "bundles", id, version);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "plugin.json"), "{}");
  if (marked) writeFileSync(join(directory, ".installed.json"), JSON.stringify({ files: {} }));
  return directory;
}

function installedLibrary(id: string, version: string, platform: string, marked = true): string {
  const directory = join(cache, "libraries", id, version, platform);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "library.json"), "{}");
  if (marked) writeFileSync(join(directory, ".installed.json"), JSON.stringify({ files: {} }));
  return directory;
}

/** Dates `path` and everything under it `hours` into the past. */
function ageBy(path: string, hours: number): string {
  const then = new Date(Date.now() - hours * 3_600_000);
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory()) ageBy(join(path, entry.name), hours);
    else utimesSync(join(path, entry.name), then, then);
  }
  utimesSync(path, then, then);
  return path;
}

function libraryPresent(id: string, version: string, platform: string): boolean {
  return existsSync(join(cache, "libraries", id, version, platform));
}

function present(id: string, version: string): boolean {
  return existsSync(join(cache, "bundles", id, version));
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "host-sweep-"));
  cache = join(base, "cache");
  state = join(base, "state");
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("sweepCache", () => {
  it("keeps every version a reference file names and the newest installed, and removes the rest", () => {
    for (const version of ["1.0.0", "1.1.0", "1.2.0", "2.0.0"]) installed("a", version);
    recordReferences(state, "claude-code", { run: { a: "1.1.0" }, next: {} });
    expect(sweepCache(cache, state).removed.sort()).toEqual(["a@1.0.0", "a@1.2.0"]);
    expect(["1.0.0", "1.1.0", "1.2.0", "2.0.0"].map((version) => present("a", version))).toEqual([false, true, false, true]);
  });

  it("keeps the versions two hosts' reference files name, so one host's sweep never takes the other's", () => {
    for (const version of ["1.0.0", "2.0.0", "3.0.0"]) installed("a", version);
    recordReferences(state, "claude-code", { run: { a: "1.0.0" }, next: {} });
    recordReferences(state, "opencode", { run: { a: "2.0.0" }, next: {} });
    expect(sweepCache(cache, state).removed).toEqual([]);
  });

  it("keeps a version a host scheduled for its next start, even one older than it runs", () => {
    for (const version of ["1.0.0", "2.0.0", "3.0.0"]) installed("a", version);
    recordReferences(state, "claude-code", { run: { a: "2.0.0" }, next: { a: "1.0.0" } });
    expect(sweepCache(cache, state).removed).toEqual([]);
  });

  it("keeps the newest installed version of an id no host references, as the rollback", () => {
    installed("a", "1.0.0");
    installed("a", "1.10.0");
    expect(sweepCache(cache, state).removed).toEqual(["a@1.0.0"]);
    expect(present("a", "1.10.0")).toBe(true);
  });

  it("leaves a version with no completion marker, which another host may still be installing", () => {
    installed("a", "1.0.0");
    installed("a", "2.0.0", false);
    installed("a", "0.5.0", false);
    expect(sweepCache(cache, state).removed).toEqual([]);
    expect(present("a", "0.5.0")).toBe(true);
  });

  it("does not follow a reference file's names out of the bundles folder", () => {
    installed("a", "1.0.0");
    installed("a", "2.0.0");
    const outside = join(base, "outside");
    mkdirSync(outside);
    recordReferences(state, "claude-code", { run: { "..": "..", a: "../../../outside" }, next: { a: "../.." } });
    expect(sweepCache(cache, state).removed).toEqual(["a@1.0.0"]);
    expect(existsSync(outside)).toBe(true);
  });

  it("answers nothing removed for a cache with no bundles", () => {
    expect(sweepCache(cache, state)).toEqual({ removed: [] });
  });

  it("sweeps library versions per platform like bundles, keeping the referenced and the newest", () => {
    for (const version of ["0.1.0", "0.2.0", "0.3.0", "0.4.0"]) installedLibrary("runtime", version, "linux-x64");
    installedLibrary("runtime", "0.1.0", "win32-x64");
    recordReferences(state, "forebay-host", { run: { runtime: "0.2.0" }, next: {} });
    expect(sweepCache(cache, state).removed.sort()).toEqual(["runtime@0.1.0 for linux-x64", "runtime@0.3.0 for linux-x64"]);
    expect(["0.1.0", "0.2.0", "0.3.0", "0.4.0"].map((version) => libraryPresent("runtime", version, "linux-x64"))).toEqual([false, true, false, true]);
    expect(libraryPresent("runtime", "0.1.0", "win32-x64")).toBe(true);
  });

  it("leaves a library version with no completion marker alone", () => {
    installedLibrary("koffi", "1.0.0", "linux-x64", false);
    installedLibrary("koffi", "2.0.0", "linux-x64");
    expect(sweepCache(cache, state).removed).toEqual([]);
  });

  it("removes a bundle version with no completion marker whose newest file is more than a day old, an install that failed", () => {
    installed("a", "1.0.0");
    ageBy(installed("a", "2.0.0", false), 25);
    expect(sweepCache(cache, state).removed).toEqual(["a@2.0.0"]);
    expect(present("a", "2.0.0")).toBe(false);
    expect(present("a", "1.0.0")).toBe(true);
  });

  it("keeps an unmarked bundle version while any one of its files is recent, an install still writing", () => {
    const directory = ageBy(installed("a", "2.0.0", false), 25);
    writeFileSync(join(directory, "index.js"), "still arriving");
    expect(sweepCache(cache, state).removed).toEqual([]);
  });

  it("keeps an old unmarked bundle version a host references", () => {
    ageBy(installed("a", "2.0.0", false), 25);
    recordReferences(state, "claude-code", { run: {}, next: { a: "2.0.0" } });
    expect(sweepCache(cache, state).removed).toEqual([]);
  });

  it("removes a library version for one platform with no completion marker that is more than a day old", () => {
    installedLibrary("koffi", "2.0.0", "linux-x64");
    ageBy(installedLibrary("koffi", "1.0.0", "linux-x64", false), 25);
    installedLibrary("koffi", "1.0.0", "win32-x64");
    expect(sweepCache(cache, state).removed).toEqual(["koffi@1.0.0 for linux-x64"]);
    expect(libraryPresent("koffi", "1.0.0", "linux-x64")).toBe(false);
    expect(libraryPresent("koffi", "1.0.0", "win32-x64")).toBe(true);
  });
});
