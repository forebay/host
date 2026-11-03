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

  it("refuses a file key the catalog would refuse", () => {
    const output = libraryOutput();
    const refused = { ...output, files: { "lib/../native.node": output.files["lib/native.node"] as string } };
    expect(() => buildLocalCatalog([{ kind: "library", output: refused, platform: "linux-x64" }], join(base, "catalog"))).toThrow(BuildRefusal);
  });
});
