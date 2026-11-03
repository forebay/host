import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readReferences, recordReferences } from "./references.js";

let state: string;

beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "host-references-"));
});

afterEach(() => {
  rmSync(state, { recursive: true, force: true });
});

describe("recordReferences", () => {
  it("writes what a host runs and what it scheduled for its next start to its own file", () => {
    recordReferences(state, "claude-code", { run: { a: "1.0.0" }, next: { a: "2.0.0" } });
    expect(JSON.parse(readFileSync(join(state, "bundles", "claude-code.json"), "utf8"))).toEqual({ run: { a: "1.0.0" }, next: { a: "2.0.0" } });
  });

  it("replaces what the same host recorded before", () => {
    recordReferences(state, "claude-code", { run: { a: "1.0.0" }, next: {} });
    recordReferences(state, "claude-code", { run: { a: "2.0.0" }, next: {} });
    expect(readReferences(state)).toEqual([{ run: { a: "2.0.0" }, next: {} }]);
  });

  it("refuses a host id that would write outside the bundles folder", () => {
    expect(() => recordReferences(state, "../escape", { run: {}, next: {} })).toThrow(/outside/);
    expect(() => recordReferences(state, "", { run: {}, next: {} })).toThrow(/outside/);
  });
});

describe("readReferences", () => {
  it("answers every host's file and skips one that is not two maps of versions", () => {
    recordReferences(state, "claude-code", { run: { a: "1.0.0" }, next: {} });
    recordReferences(state, "opencode", { run: {}, next: { a: "2.0.0" } });
    writeFileSync(join(state, "bundles", "broken.json"), "{");
    writeFileSync(join(state, "bundles", "flat.json"), JSON.stringify({ a: "3.0.0" }));
    writeFileSync(join(state, "bundles", "wrong.json"), JSON.stringify({ run: { a: 1 }, next: {} }));
    mkdirSync(join(state, "bundles", "folder.json"));
    expect(readReferences(state)).toEqual([
      { run: { a: "1.0.0" }, next: {} },
      { run: {}, next: { a: "2.0.0" } },
    ]);
  });

  it("answers nothing when no host recorded anything", () => {
    expect(readReferences(state)).toEqual([]);
  });
});
