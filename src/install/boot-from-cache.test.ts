import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CacheRefusal } from "../cache/cache-refusal.js";
import type { Catalog } from "../catalog/catalog.js";
import { readHostReferences, recordReferences } from "../updates/references.js";
import { bootFromCache, hostLibraryReferences } from "./boot-from-cache.js";
import { bootLibraries } from "./host-libraries.js";

const PLATFORM = "linux-x64";
const HOST = "forebay-host";

let base: string;
let cache: string;
let state: string;

function installed(id: string, version: string): void {
  const directory = join(cache, "libraries", id, version, PLATFORM);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, ".installed.json"), JSON.stringify({ files: {} }));
}

function catalogWithLatest(latest: Record<string, string>): Catalog {
  const items: Catalog["items"] = {};
  for (const [id, version] of Object.entries(latest)) items[id] = { kind: "library", latest: version, versions: { [version]: { files: {} } } };
  return { format: 1, items };
}

function resolution(latest: Record<string, string>, running: Record<string, string> = { [HOST]: "1.0.0" }) {
  return { cache, state, hostId: HOST, catalog: catalogWithLatest(latest), settings: {}, loaded: { runtime: "0.1.0", koffi: "2.0.0" }, running, platformKey: PLATFORM };
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "host-boot-"));
  cache = join(base, "cache");
  state = join(base, "state");
  for (const version of ["0.1.0", "0.2.0"]) installed("runtime", version);
  installed("koffi", "2.0.0");
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("hostLibraryReferences", () => {
  it("keeps what runs now and schedules what the next start loads, recording it for that start", () => {
    const references = hostLibraryReferences(resolution({ runtime: "0.2.0", koffi: "2.0.0" }));
    expect(references).toEqual({ run: { [HOST]: "1.0.0", runtime: "0.1.0", koffi: "2.0.0" }, next: { runtime: "0.2.0" } });
    expect(bootLibraries(cache, HOST, PLATFORM)).toEqual({ runtime: "0.2.0", koffi: "2.0.0" });
  });

  it("keeps the versions the host already scheduled for its next start", () => {
    recordReferences(state, HOST, { run: {}, next: { viewer: "2.0.0" } });
    expect(hostLibraryReferences(resolution({ runtime: "0.1.0", koffi: "2.0.0" })).next).toEqual({ viewer: "2.0.0" });
    expect(readHostReferences(state, HOST).next).toEqual({ viewer: "2.0.0" });
  });
});

describe("bootFromCache", () => {
  it("refuses with the install fix when no runtime and koffi are installed", () => {
    rmSync(join(cache, "libraries"), { recursive: true, force: true });
    expect(() => bootFromCache(cache, HOST)).toThrow(CacheRefusal);
    expect(() => bootFromCache(cache, HOST)).toThrow(/no runtime and koffi/);
  });
});
