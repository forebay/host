import { isBuiltin } from "node:module";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluatedInNode, pluginRepository } from "../__fixtures__/plugin-repository.js";
import { startGreeterHost } from "../__fixtures__/greeter-host.js";
import { directoryBundles } from "../plugins/bundle-source.js";
import type { RunningHost } from "../start.js";
import { callBinding } from "../ui/bindings.js";
import { BuildRefusal } from "./build-refusal.js";
import { bundlePlugin, bundlePluginWith } from "./bundle-plugin.js";

const ONLY_KOFFI = ["koffi"];

let base: string;
let running: RunningHost | undefined;

function nonBuiltins(specifiers: string[]): string[] {
  return specifiers.filter((specifier) => !isBuiltin(specifier));
}

async function refusalOf(work: Promise<unknown>): Promise<BuildRefusal> {
  const error = await work.then(() => undefined, (thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(BuildRefusal);
  return error as BuildRefusal;
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "host-bundle-"));
});

afterEach(async () => {
  await running?.stop();
  running = undefined;
  rmSync(base, { recursive: true, force: true });
});

describe("bundlePlugin", () => {
  it("writes one file importing only node builtins, a module marker beside a .js entry, and a copy of plugin.json", async () => {
    const repository = pluginRepository(join(base, "repository"), "greeter");
    const out = join(base, "out");
    const bundled = await bundlePluginWith(repository, out, ONLY_KOFFI);
    expect(bundled.output).toEqual({
      id: "greeter",
      version: "1.0.0",
      files: { "index.js": join(out, "index.js"), "package.json": join(out, "package.json"), "plugin.json": join(out, "plugin.json") },
    });
    expect(readdirSync(out).sort()).toEqual(["index.js", "package.json", "plugin.json"]);
    expect(JSON.parse(readFileSync(join(out, "package.json"), "utf8"))).toEqual({ type: "module" });
    expect(bundled.imports.length).toBeGreaterThan(0);
    expect(nonBuiltins(bundled.imports)).toEqual([]);
    expect(readFileSync(join(out, "plugin.json"), "utf8")).toBe(readFileSync(join(repository, "plugin.json"), "utf8"));
  });

  it("writes no module marker beside an .mjs entry", async () => {
    const out = join(base, "out");
    const output = await bundlePlugin(pluginRepository(join(base, "repository"), "greeter", { manifest: { entry: "index.mjs" } }), out);
    expect(Object.keys(output.files).sort()).toEqual(["index.mjs", "plugin.json"]);
    expect(readdirSync(out).sort()).toEqual(["index.mjs", "plugin.json"]);
  });

  it("puts the module marker beside an entry in a subdirectory", async () => {
    const out = join(base, "out");
    const output = await bundlePlugin(pluginRepository(join(base, "repository"), "greeter", { manifest: { entry: "dist/index.js" } }), out);
    expect(Object.keys(output.files).sort()).toEqual(["dist/index.js", "dist/package.json", "plugin.json"]);
  });

  it("leaves koffi to be resolved where the bundle runs and inlines everything else", async () => {
    const repository = pluginRepository(join(base, "repository"), "greeter", {
      sources: { "src/index.ts": 'import koffi from "koffi";\nimport "inlined-dependency";\nexport const loaded = typeof koffi;\nexport { default } from "./plugin.js";\n' },
    });
    expect(nonBuiltins((await bundlePluginWith(repository, join(base, "out"), ONLY_KOFFI)).imports)).toEqual(["koffi"]);
  });

  it("refuses a bundle that would require a package other than koffi at run time", async () => {
    const repository = pluginRepository(join(base, "repository"), "greeter", {
      sources: {
        "src/index.ts": 'import "left-external";\nexport { default } from "./plugin.js";\n',
        "node_modules/left-external/package.json": JSON.stringify({ name: "left-external", main: "index.js" }),
        "node_modules/left-external/index.js": "module.exports = {};\n",
      },
    });
    const refusal = await refusalOf(bundlePluginWith(repository, join(base, "out"), [...ONLY_KOFFI, "left-external"]));
    expect(refusal.detail).toContain("left-external");
  });

  it("loads in a plain Node process, where inlined CommonJS has no global require", async () => {
    await bundlePlugin(pluginRepository(join(base, "repository"), "greeter"), join(base, "out"));
    expect(evaluatedInNode(join(base, "out", "index.js"), "typeof loaded.default.activate", join(base, "scratch"))).toBe("function");
  });

  it("adds no require to a bundle that never requires anything", async () => {
    const repository = pluginRepository(join(base, "repository"), "greeter", { sources: { "src/index.ts": 'export { default } from "./plugin.js";\n' } });
    const bundled = await bundlePluginWith(repository, join(base, "out"), ONLY_KOFFI);
    expect(bundled.imports).toEqual([]);
    expect(readFileSync(join(base, "out", "index.js"), "utf8")).not.toContain("createRequire");
  });

  it("keeps a plugin's own top-level require beside the one inlined CommonJS needs", async () => {
    const repository = pluginRepository(join(base, "repository"), "greeter", {
      sources: {
        "src/index.ts": [
          'import { createRequire } from "node:module";',
          'import "inlined-dependency";',
          "const require = createRequire(import.meta.url);",
          'export const extension = require("node:path").extname("own.ts");',
          'export { default } from "./plugin.js";',
          "",
        ].join("\n"),
      },
    });
    await bundlePlugin(repository, join(base, "out"));
    expect(evaluatedInNode(join(base, "out", "index.js"), "loaded.extension + typeof loaded.default.activate", join(base, "scratch"))).toBe(".tsfunction");
  });

  it("bundles the source the manifest's bundle.entry names", async () => {
    const repository = pluginRepository(join(base, "repository"), "greeter", {
      manifest: { bundle: { entry: "lib/main.ts" } },
      sources: { "lib/main.ts": 'export default { activate() {}, deactivate() {} };\nexport const marker = "from lib/main";\n' },
    });
    await bundlePlugin(repository, join(base, "out"));
    expect(readFileSync(join(base, "out", "index.js"), "utf8")).toContain("from lib/main");
  });

  it("produces a bundle the host starts and calls", async () => {
    await bundlePlugin(pluginRepository(join(base, "repository"), "greeter"), join(base, "bundles", "greeter"));
    running = await startGreeterHost(base, directoryBundles(join(base, "bundles")));
    expect(running.status().active).toEqual(["greeter"]);
    expect(await callBinding(running, "greeter", { service: "demo:greeting", method: "greet" })).toEqual({ ok: true, value: { text: "from greeter" } });
  });

  it("refuses a manifest with no version, naming the fix", async () => {
    const repository = pluginRepository(join(base, "repository"), "greeter", { manifest: { version: undefined } });
    const refusal = await refusalOf(bundlePlugin(repository, join(base, "out")));
    expect(refusal.detail).toContain("no version");
    expect(refusal.fix).toContain('"version"');
  });

  it("refuses a version the catalog's version pattern refuses", async () => {
    const repository = pluginRepository(join(base, "repository"), "greeter", { manifest: { version: "1.0.0-beta." } });
    const refusal = await refusalOf(bundlePlugin(repository, join(base, "out")));
    expect(refusal.detail).toContain("1.0.0-beta.");
    expect(refusal.fix).toContain("trailing dot");
  });

  it("refuses an entry that would be written outside the output directory", async () => {
    const repository = pluginRepository(join(base, "repository"), "greeter", { manifest: { entry: "../escaped.mjs" } });
    const refusal = await refusalOf(bundlePlugin(repository, join(base, "out")));
    expect(refusal.detail).toContain("../escaped.mjs");
  });

  it.each(["plugin.json", "Package.json", "dist/package.json"])("refuses the entry %s, which the bundle's own files would replace", async (entry) => {
    const repository = pluginRepository(join(base, "repository"), "greeter", { manifest: { entry } });
    const refusal = await refusalOf(bundlePlugin(repository, join(base, "out")));
    expect(refusal.detail).toContain(entry);
  });

  it("refuses a repository with no source entry", async () => {
    const repository = pluginRepository(join(base, "repository"), "greeter", { manifest: { bundle: { entry: "missing.ts" } } });
    const refusal = await refusalOf(bundlePlugin(repository, join(base, "out")));
    expect(refusal.detail).toContain("missing.ts");
    expect(refusal.fix).toContain("bundle.entry");
  });
});
