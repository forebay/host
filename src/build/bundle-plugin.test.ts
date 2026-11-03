import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importedSpecifiers, pluginRepository } from "../__fixtures__/plugin-repository.js";
import { startGreeterHost } from "../__fixtures__/greeter-host.js";
import { directoryBundles } from "../plugins/bundle-source.js";
import type { RunningHost } from "../start.js";
import { callBinding } from "../ui/bindings.js";
import { BuildRefusal } from "./build-refusal.js";
import { bundlePlugin } from "./bundle-plugin.js";

let base: string;
let running: RunningHost | undefined;

function nonBuiltins(specifiers: string[]): string[] {
  return specifiers.filter((specifier) => !specifier.startsWith("node:"));
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
  it("writes one file importing only node builtins, beside a copy of plugin.json", async () => {
    const repository = pluginRepository(join(base, "repository"), "greeter");
    const out = join(base, "out");
    const output = await bundlePlugin(repository, out);
    expect(output).toEqual({ id: "greeter", version: "1.0.0", files: { "index.mjs": join(out, "index.mjs"), "plugin.json": join(out, "plugin.json") } });
    expect(readdirSync(out).sort()).toEqual(["index.mjs", "plugin.json"]);
    expect(nonBuiltins(importedSpecifiers(join(out, "index.mjs")))).toEqual([]);
    expect(readFileSync(join(out, "plugin.json"), "utf8")).toBe(readFileSync(join(repository, "plugin.json"), "utf8"));
  });

  it("leaves koffi to be resolved where the bundle runs and inlines everything else", async () => {
    const repository = pluginRepository(join(base, "repository"), "greeter", {
      sources: { "src/index.ts": 'import koffi from "koffi";\nimport "inlined-dependency";\nexport const loaded = typeof koffi;\nexport { default } from "./plugin.js";\n' },
    });
    await bundlePlugin(repository, join(base, "out"));
    expect(nonBuiltins(importedSpecifiers(join(base, "out", "index.mjs")))).toEqual(["koffi"]);
  });

  it("loads in a plain Node process, where inlined CommonJS has no global require", async () => {
    await bundlePlugin(pluginRepository(join(base, "repository"), "greeter"), join(base, "out"));
    const runner = join(base, "runner.mjs");
    writeFileSync(runner, `const loaded = await import(${JSON.stringify(pathToFileURL(join(base, "out", "index.mjs")).href)});
process.stdout.write(typeof loaded.default.activate);
`);
    expect(execFileSync(process.execPath, [runner], { encoding: "utf8" })).toBe("function");
  });

  it("bundles the source the manifest's bundle.entry names", async () => {
    const repository = pluginRepository(join(base, "repository"), "greeter", {
      manifest: { bundle: { entry: "lib/main.ts" } },
      sources: { "lib/main.ts": 'export default { activate() {}, deactivate() {} };\nexport const marker = "from lib/main";\n' },
    });
    await bundlePlugin(repository, join(base, "out"));
    expect(readFileSync(join(base, "out", "index.mjs"), "utf8")).toContain("from lib/main");
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

  it("refuses a repository with no source entry", async () => {
    const repository = pluginRepository(join(base, "repository"), "greeter", { manifest: { bundle: { entry: "missing.ts" } } });
    const refusal = await refusalOf(bundlePlugin(repository, join(base, "out")));
    expect(refusal.detail).toContain("missing.ts");
    expect(refusal.fix).toContain("bundle.entry");
  });
});
