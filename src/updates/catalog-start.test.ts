import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostPlaces } from "../context/places.js";
import { catalogStart } from "./catalog-start.js";

let base: string;
let places: HostPlaces;

function installed(id: string, version: string): void {
  const directory = join(places.cache, "bundles", id, version);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, ".installed.json"), JSON.stringify({ files: {} }));
}

function references(): unknown {
  return JSON.parse(readFileSync(join(places.state, "bundles", "test-host.json"), "utf8"));
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "host-catalog-start-"));
  places = { cache: join(base, "cache"), state: join(base, "state") } as HostPlaces;
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("catalogStart", () => {
  it("resolves the enabled set and the host's defaults, each default held to its pin, and records them", () => {
    for (const version of ["1.0.0", "2.0.0"]) {
      installed("a", version);
      installed("d", version);
    }
    const settings = { plugins: { a: { enabled: true }, d: { pin: "1.0.0" } } };
    catalogStart({ sources: [] }, places, "test-host", settings, { "demo:greeting": "d" });
    expect(references()).toEqual({ run: { a: "2.0.0", d: "1.0.0" }, next: {} });
  });

  it("leaves out a default the settings disable", () => {
    installed("d", "1.0.0");
    catalogStart({ sources: [] }, places, "test-host", { plugins: { d: { enabled: false } } }, { "demo:greeting": "d" });
    expect(references()).toEqual({ run: {}, next: {} });
  });
});
