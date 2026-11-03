import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installedVersions } from "./installed.js";

let cache: string;

function version(id: string, name: string, marker?: string): void {
  const directory = join(cache, "bundles", id, name);
  mkdirSync(directory, { recursive: true });
  if (marker !== undefined) writeFileSync(join(directory, ".installed.json"), marker);
}

beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), "host-installed-"));
});

afterEach(() => {
  rmSync(cache, { recursive: true, force: true });
});

describe("installedVersions", () => {
  it("answers each id's versions that carry a readable completion marker", () => {
    version("a", "1.0.0", JSON.stringify({ files: {} }));
    version("a", "2.0.0");
    version("a", "3.0.0", "{");
    version("b", "1.0.0", JSON.stringify({ files: { "plugin.json": "0".repeat(64) } }));
    expect(installedVersions(cache)).toEqual({ a: ["1.0.0"], b: ["1.0.0"] });
  });

  it("answers nothing for a cache with no bundles folder", () => {
    expect(installedVersions(cache)).toEqual({});
  });
});
