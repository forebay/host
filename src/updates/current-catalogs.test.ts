import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentCatalogs } from "./current-catalogs.js";

let directory: string;

function local(name: string, latest: string): { kind: "local"; path: string } {
  const files = { "plugin.json": { url: "plugin.json", sha256: "0".repeat(64), size: 1 } };
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify({ format: 1, items: { a: { kind: "plugin", latest, versions: { [latest]: { files } } } } }));
  return { kind: "local", path };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "host-current-catalogs-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("currentCatalogs", () => {
  it("merges every readable source, the earlier one winning an id, with no request", () => {
    const sources = [local("first.json", "1.0.0"), { kind: "https" as const, url: "https://catalog.test/index.json" }, local("second.json", "2.0.0")];
    expect(currentCatalogs(sources, join(directory, "cache")).items.a?.latest).toBe("1.0.0");
  });

  it("answers an empty catalog when no source can be read", () => {
    expect(currentCatalogs([{ kind: "local", path: join(directory, "absent.json") }], directory).items).toEqual({});
  });
});
