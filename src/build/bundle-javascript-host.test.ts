import { execFileSync } from "node:child_process";
import { isBuiltin } from "node:module";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { currentPlatformKey } from "@weivel/typescript/host";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REPOSITORY_ROOT } from "../__fixtures__/context.js";
import { bundledJavascriptHost } from "./bundle-javascript-host.js";
import { bundleKoffiLibrary } from "./koffi-library.js";

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

describe("bundleJavascriptHost", () => {
  it("writes host.js and the runtime worker as modules beside a host.json naming its entry and its runtime", async () => {
    const out = join(base, "out");
    const { output } = await bundledJavascriptHost(out);
    expect(output).toEqual({
      id: "javascript-host",
      version: PACKAGE_VERSION,
      files: {
        "host.js": join(out, "host.js"),
        "runtime-worker.js": join(out, "runtime-worker.js"),
        "package.json": join(out, "package.json"),
        "host.json": join(out, "host.json"),
      },
    });
    expect(readdirSync(out).sort()).toEqual(["host.js", "host.json", "package.json", "runtime-worker.js"]);
    expect(JSON.parse(readFileSync(join(out, "host.json"), "utf8"))).toEqual({ id: "javascript-host", version: PACKAGE_VERSION, entry: "host.js", runtime: "javascript" });
    expect(JSON.parse(readFileSync(join(out, "package.json"), "utf8"))).toEqual({ type: "module" });
  });

  it("contains no esbuild and nothing under src/build, and imports only node builtins", async () => {
    const { inputs, imports } = await bundledJavascriptHost(join(base, "out"));
    const sources = inputs.map(withSlashes);
    expect(sources.some((input) => input.endsWith("src/javascript-host/main.ts"))).toBe(true);
    expect(sources.filter((input) => input.includes("src/build/") || input.includes("node_modules/esbuild"))).toEqual([]);
    expect(sources.filter((input) => input.includes("node_modules/koffi"))).toEqual([]);
    expect(imports.filter((specifier) => !isBuiltin(specifier))).toEqual([]);
  });
});

describe("bundleKoffiLibrary", () => {
  it("lays koffi out so it loads by path from a directory with no node_modules above it", () => {
    const platform = currentPlatformKey();
    const directory = join(base, "libraries", "koffi", "2.16.3", platform);
    const output = bundleKoffiLibrary(join(REPOSITORY_ROOT, "node_modules", "koffi"), platform, directory);
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
