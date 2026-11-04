import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pluginRepository } from "../__fixtures__/plugin-repository.js";
import { readCatalog } from "../catalog/catalog.js";
import { runCommandLine } from "./main.js";
import type { CommandLineOutput } from "./main.js";

let base: string;
let printed: { out: string[]; error: string[] };
let output: CommandLineOutput;

function directoryWith(path: string, files: Record<string, string>): string {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(path, name, ".."), { recursive: true });
    writeFileSync(join(path, name), text);
  }
  return path;
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "host-cli-"));
  printed = { out: [], error: [] };
  output = { out: (line) => printed.out.push(line), error: (line) => printed.error.push(line) };
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("forebay-host", () => {
  it("bundles a repository into the directory --out names", async () => {
    const repository = pluginRepository(join(base, "repository"), "greeter");
    expect(await runCommandLine(["bundle", repository, "--out", join(base, "bundled")], output)).toBe(0);
    expect(JSON.parse(readFileSync(join(base, "bundled", "plugin.json"), "utf8")).id).toBe("greeter");
    expect(printed.out.join("\n")).toContain("greeter@1.0.0");
  });

  it("builds a catalog from plugin, host and library directories", async () => {
    await runCommandLine(["bundle", pluginRepository(join(base, "repository"), "greeter"), "--out", join(base, "bundled")], output);
    const host = directoryWith(join(base, "host"), { "host.json": JSON.stringify({ id: "forebay-host", version: "0.1.0", entry: "host.js" }), "host.js": "", "reconcile-worker.js": "" });
    const library = directoryWith(join(base, "koffi"), { "package.json": JSON.stringify({ version: "2.16.3" }), "build/koffi.node": "native" });
    const code = await runCommandLine(
      ["catalog", "build", "--plugin", join(base, "bundled"), "--host", host, "--library", `koffi=${library}@linux-x64`, "--out", join(base, "catalog")],
      output,
    );
    expect(printed.error).toEqual([]);
    expect(code).toBe(0);
    const catalogPath = join(base, "catalog", "catalog.json");
    const reading = readCatalog(readFileSync(catalogPath, "utf8"), pathToFileURL(catalogPath).href);
    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(Object.keys(reading.catalog.items).sort()).toEqual(["forebay-host", "greeter", "koffi"]);
    expect(Object.keys(reading.catalog.items.greeter?.versions["1.0.0"]?.files ?? {}).sort()).toEqual(["index.js", "package.json", "plugin.json"]);
    expect(Object.keys(reading.catalog.items["forebay-host"]?.versions["0.1.0"]?.files ?? {}).sort()).toEqual(["host.js", "host.json", "reconcile-worker.js"]);
    expect(Object.keys(reading.catalog.items.koffi?.versions["2.16.3"]?.platforms?.["linux-x64"]?.files ?? {}).sort()).toEqual(["build/koffi.node", "package.json"]);
  });

  describe("bundle-loader", () => {
    const standard = {
      application: { id: "claude", label: "Claude Code", binary: "claude", home: { candidates: ["~/.claude"] }, packages: { npm: "@anthropic-ai/claude-code" } },
      pathCommands: { requested: ["cc"], minimum: 1 },
      background: [],
    };

    function loaderRepository(module: string): string {
      const packageJson = JSON.stringify({ name: "claude-code-loader", version: "1.13.0", type: "module", main: "dist/standard.js" });
      return directoryWith(join(base, "loader"), { "package.json": packageJson, "dist/standard.js": module });
    }

    it("bundles the host under the loader's name and version with the standard its main module exports, and a catalog lists its application", async () => {
      const repository = loaderRepository(`export const standard = ${JSON.stringify(standard)};`);
      expect(await runCommandLine(["bundle-loader", repository, "--out", join(base, "bundled")], output)).toBe(0);
      expect(JSON.parse(readFileSync(join(base, "bundled", "host.json"), "utf8"))).toEqual({ id: "claude-code-loader", version: "1.13.0", entry: "host.js", ...standard });
      expect(await runCommandLine(["catalog", "build", "--host", join(base, "bundled"), "--out", join(base, "catalog")], output)).toBe(0);
      const catalogPath = join(base, "catalog", "catalog.json");
      const reading = readCatalog(readFileSync(catalogPath, "utf8"), pathToFileURL(catalogPath).href);
      expect(reading.ok && reading.catalog.items["claude-code-loader"]?.application).toEqual(standard.application);
    }, 120_000);

    it("refuses a main module that exports no standard, naming the module", async () => {
      const repository = loaderRepository("export const other = 1;");
      expect(await runCommandLine(["bundle-loader", repository, "--out", join(base, "bundled")], output)).toBe(1);
      expect(printed.error.join("\n")).toContain("standard.js");
    });
  });

  it("prints a refusal and its fix and answers 1", async () => {
    const repository = pluginRepository(join(base, "repository"), "greeter", { manifest: { version: undefined } });
    expect(await runCommandLine(["bundle", repository, "--out", join(base, "bundled")], output)).toBe(1);
    expect(printed.error.join("\n")).toMatch(/no version.*"version"/s);
  });

  it("prints the usage and answers 2 for a command it does not know", async () => {
    expect(await runCommandLine(["publish"], output)).toBe(2);
    expect(printed.error.join("\n")).toContain("forebay-host catalog build");
  });

  it("answers 2 when --out is missing", async () => {
    expect(await runCommandLine(["bundle", join(base, "repository")], output)).toBe(2);
    expect(printed.error.join("\n")).toContain("--out");
  });

  it("answers 2 for a library argument that is not id=directory@platform", async () => {
    expect(await runCommandLine(["catalog", "build", "--library", "koffi", "--out", join(base, "catalog")], output)).toBe(2);
    expect(printed.error.join("\n")).toContain("<id>=<directory>@<platform>");
  });
});
