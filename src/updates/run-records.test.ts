import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostPlaces } from "../context/places.js";
import { catalogStart } from "./catalog-start.js";
import { removeHostReferences } from "./references.js";
import { holdRunRecord, liveRuns } from "./run-records.js";
import { sweepCache } from "./sweep.js";

const HOST = "fixture-loader";
const SETTINGS = { plugins: { a: { enabled: true } } };

let base: string;
let places: HostPlaces;

function installed(id: string, version: string): void {
  const directory = join(places.cache, "bundles", id, version);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, ".installed.json"), JSON.stringify({ files: {} }));
}

function isInstalled(id: string, version: string): boolean {
  return existsSync(join(places.cache, "bundles", id, version));
}

function deadPid(): number {
  return Number(spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout);
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "host-run-records-"));
  places = { cache: join(base, "cache"), state: join(base, "state") } as HostPlaces;
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("a start's run record", () => {
  it("keeps the plugin version each of two concurrent starts of one host runs, and lets a sweep take one once its start stopped", () => {
    installed("a", "1.0.0");
    const first = catalogStart({ sources: [] }, places, HOST, SETTINGS, {});
    installed("a", "2.0.0");
    const second = catalogStart({ sources: [] }, places, HOST, SETTINGS, {});
    sweepCache(places.cache, places.state);
    expect([isInstalled("a", "1.0.0"), isInstalled("a", "2.0.0")]).toEqual([true, true]);

    first.releaseRun();
    sweepCache(places.cache, places.state);
    expect([isInstalled("a", "1.0.0"), isInstalled("a", "2.0.0")]).toEqual([false, true]);
    second.releaseRun();
  });

  it("is pruned once its process is gone, freshly stamped or not, and its versions with it", () => {
    installed("a", "1.0.0");
    installed("a", "2.0.0");
    const directory = join(places.state, "bundles", "runs", HOST);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${deadPid()}.dead.json`), JSON.stringify({ pid: deadPid(), aliveAt: Date.now(), checkMilliseconds: 5000, run: { a: "1.0.0" } }));

    expect(liveRuns(places.state)).toEqual([]);
    expect(readdirSync(directory)).toEqual([]);
    sweepCache(places.cache, places.state);
    expect(isInstalled("a", "1.0.0")).toBe(false);
  });

  it("is pruned once its process stops stamping, though the process lives", () => {
    const directory = join(places.state, "bundles", "runs", HOST);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${process.pid}.stale.json`), JSON.stringify({ pid: process.pid, aliveAt: Date.now() - 60000, checkMilliseconds: 5000, run: { a: "1.0.0" } }));

    expect(liveRuns(places.state)).toEqual([]);
  });

  it("is deleted, with every other run of the host, when the host's references are removed", () => {
    const held = holdRunRecord(places.state, HOST, { a: "1.0.0" });
    try {
      removeHostReferences(places.state, HOST);
      expect(liveRuns(places.state)).toEqual([]);
      expect(existsSync(join(places.state, "bundles", "runs", HOST))).toBe(false);
    } finally {
      held.release();
    }
  });
});
