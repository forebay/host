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
  it("writes the versions a host runs to its own file under the state's bundles folder", () => {
    recordReferences(state, "claude-code", { a: "1.0.0" });
    expect(JSON.parse(readFileSync(join(state, "bundles", "claude-code.json"), "utf8"))).toEqual({ a: "1.0.0" });
  });

  it("replaces what the same host recorded before", () => {
    recordReferences(state, "claude-code", { a: "1.0.0" });
    recordReferences(state, "claude-code", { a: "2.0.0" });
    expect(readReferences(state)).toEqual([{ a: "2.0.0" }]);
  });

  it("refuses a host id that would write outside the bundles folder", () => {
    expect(() => recordReferences(state, "../escape", { a: "1.0.0" })).toThrow(/outside/);
    expect(() => recordReferences(state, "", { a: "1.0.0" })).toThrow(/outside|host id/);
  });
});

describe("readReferences", () => {
  it("answers every host's file and skips one that is not a map of versions", () => {
    recordReferences(state, "claude-code", { a: "1.0.0" });
    recordReferences(state, "opencode", { a: "2.0.0" });
    writeFileSync(join(state, "bundles", "broken.json"), "{");
    writeFileSync(join(state, "bundles", "wrong.json"), JSON.stringify({ a: 1 }));
    mkdirSync(join(state, "bundles", "folder.json"));
    expect(readReferences(state)).toEqual([{ a: "1.0.0" }, { a: "2.0.0" }]);
  });

  it("answers nothing when no host recorded anything", () => {
    expect(readReferences(state)).toEqual([]);
  });
});
