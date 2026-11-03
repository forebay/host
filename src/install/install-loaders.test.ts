import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REPOSITORY_ROOT } from "../__fixtures__/context.js";
import { userPathEntriesUnder } from "../__fixtures__/user-path.js";
import { buildLocalCatalog } from "../build/local-catalog.js";
import { hostDirectoryOutput } from "../build/built-directory.js";
import { defaultFetcher } from "../cache/fetcher.js";
import type { Catalog } from "../catalog/catalog.js";
import type { HostPlaces } from "../context/places.js";
import { hostsApi } from "../hosts.js";
import { openRuntime, siblingRuntime } from "../runtime/open.js";
import type { Runtime } from "../runtime/open.js";
import { installCatalog } from "./install-catalog.js";
import { installLoaders } from "./install-loaders.js";
import { readHostReferences, recordReferences } from "../updates/references.js";
import { emptyReport } from "./install-report.js";
import type { InstallReport } from "./install-report.js";

const NO_COMMANDS = { requested: [] as string[], minimum: 0 };

interface LoaderSpec {
  id: string;
  applicationId: string;
  pathCommands: { requested: string[]; minimum: number };
}

let base: string;
let environment: Record<string, string>;
let runtime: Runtime;
let places: HostPlaces;

function writeLoader(spec: LoaderSpec): string {
  const directory = join(base, "loaders", spec.id);
  mkdirSync(directory, { recursive: true });
  const manifest = {
    id: spec.id,
    version: "1.0.0",
    entry: "host.js",
    application: {
      id: spec.applicationId,
      label: spec.applicationId,
      binary: `${spec.applicationId}-binary-absent`,
      home: { candidates: [`~/homes/${spec.applicationId}`] },
      packages: {},
    },
    pathCommands: spec.pathCommands,
    background: [],
  };
  writeFileSync(join(directory, "host.json"), JSON.stringify(manifest));
  writeFileSync(join(directory, "host.js"), "export {};\n");
  return directory;
}

async function catalogOf(specs: LoaderSpec[]): Promise<Catalog> {
  const inputs = specs.map((spec) => ({ kind: "host" as const, output: hostDirectoryOutput(writeLoader(spec)) }));
  const path = buildLocalCatalog(inputs, join(base, "catalog"));
  return installCatalog([{ kind: "local", path }], places.cache, emptyReport());
}

function reportOf(applications: Array<{ id: string; state: "installed" | "detected" | "missing" | "skipped" }>): InstallReport {
  return { ...emptyReport(), applications };
}

async function install(catalog: Catalog, report: InstallReport): Promise<void> {
  await installLoaders({ catalog, places, runtimeSource: siblingRuntime(REPOSITORY_ROOT), fetcher: defaultFetcher(), environment }, report);
}

function registration(id: string): Record<string, unknown> | undefined {
  return runtime.registry.get({ places, id }).registration;
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "host-loaders-"));
  const userHome = join(base, "user");
  mkdirSync(userHome, { recursive: true });
  environment = { PATH: join(base, "path"), HOME: userHome, USERPROFILE: userHome, SHELL: "/bin/sh" };
  runtime = openRuntime(siblingRuntime(REPOSITORY_ROOT));
  places = runtime.places.resolve({
    home: userHome,
    environment: { SPISOR_HOME: join(base, "portable"), SPISOR_STATE: join(base, "state"), SPISOR_CACHE: join(base, "cache"), SPISOR_SECRETS: join(base, "secrets") },
  });
});

afterEach(() => {
  runtime.close();
  rmSync(base, { recursive: true, force: true });
});

describe("installLoaders without commands", () => {
  const TWO: LoaderSpec[] = [
    { id: "alpha-loader", applicationId: "alpha", pathCommands: NO_COMMANDS },
    { id: "beta-loader", applicationId: "beta", pathCommands: NO_COMMANDS },
  ];

  it("registers one loader per installed or detected application, each with its own home and catalog provenance", async () => {
    const catalog = await catalogOf(TWO);
    const report = reportOf([{ id: "alpha", state: "installed" }, { id: "beta", state: "detected" }]);
    await install(catalog, report);

    expect(report.loaders.map(({ id, application }) => [id, application])).toEqual([["alpha-loader", "alpha"], ["beta-loader", "beta"]]);
    expect(report.loaders.map(({ home }) => home)).toEqual([join(base, "user", "homes", "alpha"), join(base, "user", "homes", "beta")]);
    expect(registration("alpha-loader")).toMatchObject({ kind: "host", version: "1.0.0", home: join(base, "user", "homes", "alpha"), application: { id: "alpha" }, provenance: { method: "catalog", version: "1.0.0" } });
    expect(registration("beta-loader")).toMatchObject({ application: { id: "beta" } });
    expect(report.unavailable).toEqual([]);
  });

  it("records the registered version of each loader as a reference, keeping what it already scheduled", async () => {
    const catalog = await catalogOf(TWO);
    recordReferences(places.state, "alpha-loader", { run: { "alpha-loader": "0.9.0" }, next: { "alpha-loader": "2.0.0" } });
    await install(catalog, reportOf([{ id: "alpha", state: "installed" }, { id: "beta", state: "detected" }]));

    expect(readHostReferences(places.state, "alpha-loader")).toEqual({ run: { "alpha-loader": "1.0.0" }, next: { "alpha-loader": "2.0.0" } });
    expect(readHostReferences(places.state, "beta-loader")).toEqual({ run: { "beta-loader": "1.0.0" }, next: {} });
  });

  it("registers nothing for an application that is neither installed nor detected", async () => {
    const catalog = await catalogOf(TWO);
    const report = reportOf([{ id: "alpha", state: "installed" }, { id: "beta", state: "missing" }]);
    await install(catalog, report);

    expect(report.loaders.map(({ id }) => id)).toEqual(["alpha-loader"]);
    expect(registration("beta-loader")).toBeUndefined();
    expect(readdirSync(join(places.cache, "bundles"))).toEqual(["alpha-loader"]);
  });

  it("keeps the first install's provenance on a second install", async () => {
    const catalog = await catalogOf(TWO);
    await install(catalog, reportOf([{ id: "alpha", state: "installed" }]));
    const first = registration("alpha-loader");

    await new Promise((resolve) => setTimeout(resolve, 20));
    await install(catalog, reportOf([{ id: "alpha", state: "installed" }]));

    expect(registration("alpha-loader")).toEqual(first);
  });
});

describe.runIf(process.env.CI === "true")("installLoaders with commands", () => {
  const registeredIds: string[] = [];

  afterEach(() => {
    for (const id of registeredIds.splice(0)) hostsApi(runtime, places, environment).remove(id);
    const bin = join(places.state, "bin");
    expect(userPathEntriesUnder(base)).toEqual([]);
    expect(existsSync(bin) ? readdirSync(bin) : []).toEqual([]);
  });

  it("requests each requested command and starts the loader through the running host bundle", async () => {
    registeredIds.push("gamma-loader");
    const catalog = await catalogOf([{ id: "gamma-loader", applicationId: "gamma", pathCommands: { requested: ["gamma-cmd"], minimum: 1 } }]);
    const report = reportOf([{ id: "gamma", state: "installed" }]);
    await install(catalog, report);

    expect(report.loaders[0]).toMatchObject({ id: "gamma-loader", commands: ["gamma-cmd"], refusedCommands: [] });
    if (process.platform !== "win32") {
      const shim = readFileSync(join(places.state, "bin", "gamma-cmd"), "utf8");
      expect(shim).toContain(process.execPath);
      expect(shim).toContain(join(places.cache, "boot", "boot.js"));
      expect(shim).toContain("launch");
      expect(shim).toContain("gamma-loader");
    }
  });

  it.runIf(process.platform !== "win32")("gives cc a fallback name because the C compiler holds it", async () => {
    registeredIds.push("delta-loader");
    const catalog = await catalogOf([{ id: "delta-loader", applicationId: "delta", pathCommands: { requested: ["cc"], minimum: 1 } }]);
    const report = reportOf([{ id: "delta", state: "installed" }]);
    environment.PATH = "/usr/bin:/bin";
    await install(catalog, report);

    expect(report.loaders[0]?.commands).toHaveLength(1);
    expect(report.loaders[0]?.commands[0]).not.toBe("cc");
    expect(report.loaders[0]?.commands[0]).toMatch(/^cc/);
  });
});
