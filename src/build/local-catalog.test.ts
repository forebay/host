import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluatedInNode, pluginRepository } from "../__fixtures__/plugin-repository.js";
import { startGreeterHost } from "../__fixtures__/greeter-host.js";
import { cacheBundleSource } from "../cache/cache-bundle-source.js";
import { defaultFetcher } from "../cache/fetcher.js";
import { installVersion } from "../cache/install-version.js";
import { readCatalog } from "../catalog/catalog.js";
import type { Catalog } from "../catalog/catalog.js";
import type { RunningHost } from "../start.js";
import { callBinding } from "../ui/bindings.js";
import { BuildRefusal } from "./build-refusal.js";
import { hostDirectoryOutput } from "./built-directory.js";
import { bundlePlugin } from "./bundle-plugin.js";
import type { BundleOutput } from "./bundle-plugin.js";
import { buildLocalCatalog } from "./local-catalog.js";

let base: string;
let running: RunningHost | undefined;

async function greeterAt(version: string): Promise<BundleOutput> {
  const repository = pluginRepository(join(base, "repositories", version), "greeter", { manifest: { version } });
  return bundlePlugin(repository, join(base, "bundled", version));
}

function libraryOutput(): BundleOutput {
  const file = join(base, "library", "lib", "native.node");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, "native bytes");
  return { id: "koffi", version: "2.16.3", files: { "lib/native.node": file } };
}

function readBack(catalogPath: string): Catalog {
  const reading = readCatalog(readFileSync(catalogPath, "utf8"), pathToFileURL(catalogPath).href);
  if (!reading.ok) throw new Error(`${reading.refusal.detail}; ${reading.refusal.fix}`);
  return reading.catalog;
}

function sha256Of(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "host-catalog-build-"));
});

afterEach(async () => {
  await running?.stop();
  running = undefined;
  rmSync(base, { recursive: true, force: true });
});

describe("buildLocalCatalog", () => {
  it("writes an index of relative urls the catalog reader accepts, latest by semver", async () => {
    const outputs = await Promise.all(["1.2.0", "1.10.0", "1.10.0-beta.1"].map(greeterAt));
    const catalogPath = buildLocalCatalog(outputs.map((output) => ({ kind: "plugin" as const, output })), join(base, "catalog"));
    expect(catalogPath).toBe(join(base, "catalog", "catalog.json"));
    const raw = JSON.parse(readFileSync(catalogPath, "utf8"));
    expect(raw.items.greeter.versions["1.10.0"].files["index.js"].url).toBe("files/greeter/1.10.0/index.js");
    const catalog = readBack(catalogPath);
    expect(catalog.items.greeter?.latest).toBe("1.10.0");
    expect(Object.keys(catalog.items.greeter?.versions ?? {}).sort()).toEqual(["1.10.0", "1.10.0-beta.1", "1.2.0"]);
  });

  it("lists a plugin as the provider of the install method its manifest names", async () => {
    const repository = pluginRepository(join(base, "repositories", "provider"), "greeter", { manifest: { installMethod: "fake" } });
    const output = await bundlePlugin(repository, join(base, "bundled", "provider"));
    const catalog = readBack(buildLocalCatalog([{ kind: "plugin", output }], join(base, "catalog")));
    expect(catalog.items.greeter?.installMethod).toBe("fake");
  });

  it("lists every copied file with its real hash and size", async () => {
    const catalog = readBack(buildLocalCatalog([{ kind: "plugin", output: await greeterAt("1.0.0") }], join(base, "catalog")));
    for (const reference of Object.values(catalog.items.greeter?.versions["1.0.0"]?.files ?? {})) {
      const copied = fileURLToPath(reference.url);
      expect(copied.startsWith(join(base, "catalog", "files", "greeter", "1.0.0"))).toBe(true);
      expect(reference.sha256).toBe(sha256Of(copied));
      expect(reference.size).toBe(readFileSync(copied).length);
    }
  });

  it("places a per-platform item under its platform", () => {
    const catalog = readBack(buildLocalCatalog([{ kind: "library", output: libraryOutput(), platform: "linux-x64" }], join(base, "catalog")));
    const reference = catalog.items.koffi?.versions["2.16.3"]?.platforms?.["linux-x64"]?.files["lib/native.node"];
    expect(reference?.url).toBe(pathToFileURL(join(base, "catalog", "files", "koffi", "2.16.3", "linux-x64", "lib", "native.node")).href);
    expect(catalog.items.koffi?.kind).toBe("library");
  });

  it("installs from the index with the default fetcher into a bundle the host runs", async () => {
    const catalog = readBack(buildLocalCatalog([{ kind: "plugin", output: await greeterAt("1.0.0") }], join(base, "catalog")));
    const cache = join(base, "cache");
    const installed = await installVersion(cache, "greeter", catalog.items.greeter!, "1.0.0", defaultFetcher());
    expect(installed.ok && [...installed.fetched].sort()).toEqual(["index.js", "package.json", "plugin.json"]);
    expect(evaluatedInNode(join(cache, "bundles", "greeter", "1.0.0", "index.js"), "typeof loaded.default.activate", join(base, "scratch"))).toBe("function");
    running = await startGreeterHost(base, cacheBundleSource(cache, { greeter: "1.0.0" }));
    expect(await callBinding(running, "greeter", { service: "demo:greeting", method: "greet" })).toEqual({ ok: true, value: { text: "from greeter" } });
  });

  it("refuses one id under two kinds", async () => {
    const output = await greeterAt("1.0.0");
    expect(() => buildLocalCatalog([{ kind: "plugin", output }, { kind: "host", output: { ...output, version: "2.0.0" } }], join(base, "catalog"))).toThrow(BuildRefusal);
  });

  it("refuses the same version of an item twice", async () => {
    const output = await greeterAt("1.0.0");
    expect(() => buildLocalCatalog([{ kind: "plugin", output }, { kind: "plugin", output }], join(base, "catalog"))).toThrow(/twice/);
  });

  it("refuses a platform that is not an os-arch key, before copying anything", () => {
    expect(() => buildLocalCatalog([{ kind: "library", output: libraryOutput(), platform: "../escape" }], join(base, "catalog"))).toThrow(/platform/);
    expect(() => readFileSync(join(base, "escape"))).toThrow();
  });

  it("refuses a file the installer would take for its completion marker, in any case", () => {
    const output = libraryOutput();
    const marker = { ...output, files: { ".INSTALLED.json": output.files["lib/native.node"] as string } };
    expect(() => buildLocalCatalog([{ kind: "library", output: marker, platform: "linux-x64" }], join(base, "catalog"))).toThrow(/\.INSTALLED\.json/);
    expect(() => readFileSync(join(base, "catalog", "catalog.json"))).toThrow();
  });

  it("refuses two file keys that differ only by case, before copying anything", () => {
    const output = libraryOutput();
    const source = output.files["lib/native.node"] as string;
    const colliding = { ...output, files: { "lib/Native.node": source, "lib/native.node": source } };
    expect(() => buildLocalCatalog([{ kind: "library", output: colliding, platform: "linux-x64" }], join(base, "catalog"))).toThrow(/lib\/Native\.node.*lib\/native\.node/);
    expect(() => readFileSync(join(base, "catalog", "catalog.json"))).toThrow();
  });

  it("refuses a platform file that differs only by case from a file given for every platform", () => {
    const output = libraryOutput();
    const source = output.files["lib/native.node"] as string;
    const shared = { ...output, files: { "README.md": source } };
    const platform = { ...output, files: { "readme.md": source } };
    expect(() => buildLocalCatalog([{ kind: "library", output: shared }, { kind: "library", output: platform, platform: "linux-x64" }], join(base, "catalog"))).toThrow(BuildRefusal);
  });

  it("refuses a file key the catalog would refuse", () => {
    const output = libraryOutput();
    const refused = { ...output, files: { "lib/../native.node": output.files["lib/native.node"] as string } };
    expect(() => buildLocalCatalog([{ kind: "library", output: refused, platform: "linux-x64" }], join(base, "catalog"))).toThrow(BuildRefusal);
  });
});

describe("buildLocalCatalog with a loader standard", () => {
  const standard = {
    application: { id: "claude-code", label: "Claude Code", binary: "claude", home: { candidates: ["~/.claude"] }, packages: { npm: "@anthropic-ai/claude-code" } },
    pathCommands: { requested: ["claude"], minimum: 0 },
    background: ["forebay-host"],
  };

  function loaderDirectory(): string {
    const directory = join(base, "loader");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "host.js"), "export {};\n");
    writeFileSync(join(directory, "host.json"), JSON.stringify({ id: "claude-code-loader", version: "1.0.0", entry: "host.js", ...standard }));
    return directory;
  }

  it("lists the application of a host.json on its host item", () => {
    const catalog = readBack(buildLocalCatalog([{ kind: "host", output: hostDirectoryOutput(loaderDirectory()) }], join(base, "catalog")));
    expect(catalog.items["claude-code-loader"]?.application).toEqual(standard.application);
  });

  it("lists no application for a host.json that has none", () => {
    const directory = join(base, "plain");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "host.json"), JSON.stringify({ id: "plain-host", version: "1.0.0", entry: "host.js" }));
    const catalog = readBack(buildLocalCatalog([{ kind: "host", output: hostDirectoryOutput(directory) }], join(base, "catalog")));
    expect(catalog.items["plain-host"]).not.toHaveProperty("application");
  });

  it("refuses an application on anything but a host", () => {
    const output = hostDirectoryOutput(loaderDirectory());
    expect(() => buildLocalCatalog([{ kind: "plugin", output }], join(base, "catalog"))).toThrow(/application/);
  });

  it("refuses a host.json whose standard is invalid", () => {
    const directory = loaderDirectory();
    writeFileSync(join(directory, "host.json"), JSON.stringify({ id: "claude-code-loader", version: "1.0.0", entry: "host.js", ...standard, application: { ...standard.application, binary: "" } }));
    expect(() => hostDirectoryOutput(directory)).toThrow(/\/application\/binary/);
  });
});
