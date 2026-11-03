import { execFileSync } from "node:child_process";
import { isBuiltin } from "node:module";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { currentPlatformKey } from "@weivel/typescript/host";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REPOSITORY_ROOT } from "../__fixtures__/context.js";
import { bundledHost } from "./bundle-host.js";
import { koffiLibraryOutput } from "./koffi-library.js";

const PACKAGE_VERSION = (JSON.parse(readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8")) as { version: string }).version;

let base: string;

function withSlashes(input: string): string {
  return input.split(sep).join("/");
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "host-bundle-host-"));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("bundleHost", () => {
  it("writes host.js and reconcile-worker.js as modules beside a host.json", async () => {
    const out = join(base, "out");
    const { output } = await bundledHost(out);
    expect(output).toEqual({
      id: "forebay-host",
      version: PACKAGE_VERSION,
      files: {
        "host.js": join(out, "host.js"),
        "reconcile-worker.js": join(out, "reconcile-worker.js"),
        "package.json": join(out, "package.json"),
        "host.json": join(out, "host.json"),
      },
    });
    expect(readdirSync(out).sort()).toEqual(["host.js", "host.json", "package.json", "reconcile-worker.js"]);
    expect(JSON.parse(readFileSync(join(out, "host.json"), "utf8"))).toEqual({ id: "forebay-host", version: PACKAGE_VERSION, entry: "host.js" });
    expect(JSON.parse(readFileSync(join(out, "package.json"), "utf8"))).toEqual({ type: "module" });
  });

  it("writes application, pathCommands and background into host.json when given a loader standard", async () => {
    const out = join(base, "out");
    const standard = {
      application: { id: "claude-code", label: "Claude Code", binary: "claude", home: { candidates: ["~/.claude"] }, packages: { npm: "@anthropic-ai/claude-code" } },
      pathCommands: { requested: ["claude"], minimum: 0 as const },
      background: ["forebay-host"],
    };
    await bundledHost(out, standard);
    expect(JSON.parse(readFileSync(join(out, "host.json"), "utf8"))).toEqual({ id: "forebay-host", version: PACKAGE_VERSION, entry: "host.js", ...standard });
  });

  it("refuses a loader standard that checkLoaderStandard refuses", async () => {
    await expect(bundledHost(join(base, "out"), { application: {}, pathCommands: {}, background: [] } as never)).rejects.toThrow(/\/application\/id/);
  });

  it("contains no esbuild and nothing under src/build, and imports only node builtins", async () => {
    const { inputs, imports } = await bundledHost(join(base, "out"));
    const sources = inputs.map(withSlashes);
    expect(sources.some((input) => input.endsWith("src/cli/host-main.ts"))).toBe(true);
    expect(sources.filter((input) => input.includes("src/build/") || input.includes("node_modules/esbuild"))).toEqual([]);
    expect(sources.filter((input) => input.includes("node_modules/koffi"))).toEqual([]);
    expect(imports.filter((specifier) => !isBuiltin(specifier))).toEqual([]);
  });
});

describe("koffiLibraryOutput", () => {
  it("lays koffi out so it loads by path from a directory with no node_modules above it", () => {
    const platform = currentPlatformKey();
    const directory = join(base, "libraries", "koffi", "2.16.3", platform);
    const output = koffiLibraryOutput(join(REPOSITORY_ROOT, "node_modules", "koffi"), platform, directory);
    expect(output.id).toBe("koffi");
    expect(output.version).toBe("2.16.3");
    expect(Object.keys(output.files)).toContain("index.js");
    expect(Object.keys(output.files).filter((key) => key.endsWith("koffi.node")).length).toBeGreaterThan(0);
    const scratch = join(base, "probe");
    mkdirSync(scratch, { recursive: true });
    const runner = join(scratch, "probe.mjs");
    writeFileSync(
      runner,
      [
        'import { createRequire } from "node:module";',
        `const koffi = createRequire(import.meta.url)(${JSON.stringify(join(directory, "index.js"))});`,
        "process.stdout.write(String(typeof koffi.load));",
      ].join("\n"),
    );
    const env = process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot };
    expect(execFileSync(process.execPath, [runner], { cwd: scratch, env, encoding: "utf8" })).toBe("function");
    expect(pathToFileURL(runner).href.includes("node_modules")).toBe(false);
  });
});
