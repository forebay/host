import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REPOSITORY_ROOT } from "../__fixtures__/context.js";
import { siblingRuntime } from "../runtime/open.js";
import { bundleLoader } from "./bundle-loader.js";

const RUNTIME = siblingRuntime(REPOSITORY_ROOT);

const STANDARD = {
  application: { id: "claude-code", label: "Claude Code", binary: "claude", home: { candidates: ["~/.claude"] }, packages: { npm: "@anthropic-ai/claude-code" } },
  pathCommands: { requested: ["claude"], minimum: 0 },
  background: ["forebay-host"],
};

let base: string;

function loaderRepository(standard: unknown): string {
  const repository = join(base, "loader");
  mkdirSync(join(repository, "dist"), { recursive: true });
  writeFileSync(join(repository, "package.json"), JSON.stringify({ name: "claude-code-loader", version: "1.13.0", type: "module", main: "dist/standard.js" }));
  writeFileSync(join(repository, "dist", "standard.js"), `export const standard = ${JSON.stringify(standard)};`);
  return repository;
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "host-bundle-loader-"));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("bundleLoader", () => {
  it("writes a data-only bundle: exactly a host.json naming the loader's id and version and carrying its standard", async () => {
    const out = join(base, "out");
    const output = await bundleLoader(loaderRepository(STANDARD), out, RUNTIME);
    expect(readdirSync(out)).toEqual(["host.json"]);
    expect(JSON.parse(readFileSync(join(out, "host.json"), "utf8"))).toEqual({ id: "claude-code-loader", version: "1.13.0", runtime: "native", ...STANDARD });
    expect(output).toEqual({ id: "claude-code-loader", version: "1.13.0", files: { "host.json": join(out, "host.json") }, application: STANDARD.application });
  });

  it("keeps the loader's id and version over an id or version the standard carries", async () => {
    const out = join(base, "out");
    await bundleLoader(loaderRepository({ ...STANDARD, id: "forebay-host", version: "9.9.9", runtime: "javascript" }), out, RUNTIME);
    expect(JSON.parse(readFileSync(join(out, "host.json"), "utf8"))).toMatchObject({ id: "claude-code-loader", version: "1.13.0", runtime: "native" });
  });

  it("refuses a standard loader.check refuses, writing nothing", async () => {
    const out = join(base, "out");
    await expect(bundleLoader(loaderRepository({ application: {}, pathCommands: {}, background: [] }), out, RUNTIME)).rejects.toThrow(/\/application\/id/);
    expect(() => readdirSync(out)).toThrow();
  });
});
