import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentPlatformKey } from "@weivel/typescript/host";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { REPOSITORY_ROOT } from "../__fixtures__/context.js";
import { ecosystemCatalog, OLDER_RUNTIME_VERSION, placesEnvironment } from "../__fixtures__/ecosystem-catalog.js";
import type { EcosystemCatalog } from "../__fixtures__/ecosystem-catalog.js";
import { defaultFetcher } from "../cache/fetcher.js";
import type { Fetcher } from "../cache/fetcher.js";
import type { HostPlaces } from "../context/places.js";
import { openRuntime, siblingRuntime } from "../runtime/open.js";
import { readReferences, recordReferences } from "../updates/references.js";
import { bootLibraries } from "./host-libraries.js";
import { installEcosystem } from "./install-ecosystem.js";
import type { InstallReport } from "./install-ecosystem.js";

const FIXTURE_PLUGINS = ["announcer", "viewer"];

let workspace: string;
let catalog: EcosystemCatalog;
let base: string;
let environment: Record<string, string>;
let places: HostPlaces;

interface CountingFetcher extends Fetcher {
  count: number;
}

function countingFetcher(): CountingFetcher {
  const inner = defaultFetcher();
  const counting: CountingFetcher = {
    count: 0,
    fetch(url) {
      counting.count += 1;
      return inner.fetch(url);
    },
  };
  return counting;
}

function hostHome(): string {
  return join(places.state, "home", "forebay-host");
}

function settings(): Record<string, unknown> {
  const runtime = openRuntime(siblingRuntime(REPOSITORY_ROOT));
  try {
    return runtime.settings.all({ home: hostHome(), portable: places.portable }).values;
  } finally {
    runtime.close();
  }
}

function setPortable(key: string, value: unknown): void {
  const runtime = openRuntime(siblingRuntime(REPOSITORY_ROOT));
  try {
    runtime.settings.set({ home: hostHome(), portable: places.portable, key, value, layer: "portable" });
  } finally {
    runtime.close();
  }
}

function install(defaults: string[], fetcher: Fetcher = countingFetcher(), requested: string[] = []): Promise<InstallReport> {
  return installEcosystem({ catalog: [{ kind: "local", path: catalog.path }], places, home: hostHome(), defaults, requested, fetcher });
}

function ids(report: InstallReport): string[] {
  return report.installed.map(({ id }) => id).sort();
}

/** @implNote Only what the child needs to find its places; no PATH, no NODE_PATH, so nothing resolves through node_modules. */
function childEnvironment(): Record<string, string> {
  const systemRoot = process.env.SystemRoot;
  return { ...environment, ...(systemRoot === undefined ? {} : { SystemRoot: systemRoot }) };
}

function hostFile(): string {
  return join(places.cache, "bundles", "forebay-host", catalog.hostVersion, "host.js");
}

function runHost(...argv: string[]): string {
  return execFileSync(process.execPath, [hostFile(), ...argv], { cwd: base, env: childEnvironment(), encoding: "utf8" });
}

function refusedHost(...argv: string[]): { status: number | null; stderr: string } {
  try {
    runHost(...argv);
  } catch (error) {
    const failed = error as { status: number | null; stderr: string };
    return { status: failed.status, stderr: String(failed.stderr) };
  }
  throw new Error(`forebay-host ${argv.join(" ")} was expected to fail`);
}

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), "host-ecosystem-"));
  catalog = await ecosystemCatalog(workspace);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "host-install-"));
  environment = placesEnvironment(base);
  const runtime = openRuntime(siblingRuntime(REPOSITORY_ROOT));
  try {
    places = runtime.places.resolve({ home: environment.HOME as string, environment });
  } finally {
    runtime.close();
  }
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("installEcosystem", () => {
  it("installs the host, the runtime, koffi and the defaults, and records them", async () => {
    const report = await install(FIXTURE_PLUGINS);
    expect(ids(report)).toEqual(["announcer", "forebay-host", "koffi", "runtime", "viewer"]);
    expect(report.cached).toEqual([]);
    expect(report.unavailable).toEqual([]);
    expect(report.enabled).toEqual(FIXTURE_PLUGINS);
    const platform = currentPlatformKey();
    expect(existsSync(join(places.cache, "libraries", "koffi", "2.16.3", platform, "index.js"))).toBe(true);
    expect(existsSync(join(places.cache, "bundles", "forebay-host", catalog.hostVersion, "host.js"))).toBe(true);
    const written = settings();
    expect(written.plugins).toEqual({ announcer: { enabled: true }, viewer: { enabled: true } });
    expect(written.catalog).toEqual({ sources: [{ kind: "local", path: catalog.path }] });
    const [references] = readReferences(places.state);
    expect(references?.run).toMatchObject({ "forebay-host": catalog.hostVersion, runtime: "0.1.0", koffi: "2.16.3", viewer: "1.0.0", announcer: "1.0.0" });
  });

  it("reports everything cached on a second run and fetches nothing", async () => {
    await install(FIXTURE_PLUGINS);
    const fetcher = countingFetcher();
    const report = await install(FIXTURE_PLUGINS, fetcher);
    expect(report.installed).toEqual([]);
    expect(report.enabled).toEqual([]);
    expect(report.cached.sort()).toEqual(["announcer@1.0.0", `forebay-host@${catalog.hostVersion}`, "koffi@2.16.3", "runtime@0.1.0", "viewer@1.0.0"]);
    expect(fetcher.count).toBe(0);
  });

  it("leaves a plugin the user disabled between runs disabled", async () => {
    await install(FIXTURE_PLUGINS);
    setPortable("plugins.announcer.enabled", false);
    const report = await install(FIXTURE_PLUGINS);
    expect(report.cached).not.toContain("announcer@1.0.0");
    expect(settings().plugins).toEqual({ announcer: { enabled: false }, viewer: { enabled: true } });
  });

  it("reports an item with no build for this platform unavailable and installs the rest", async () => {
    const report = await install([...FIXTURE_PLUGINS, "rival"]);
    expect(ids(report)).toEqual(["announcer", "forebay-host", "koffi", "runtime", "viewer"]);
    expect(report.unavailable).toHaveLength(1);
    expect(report.unavailable[0]).toMatchObject({ id: "rival", detail: `not built for ${currentPlatformKey()}` });
    expect(report.unavailable[0]?.fix).not.toBe("");
    expect(settings().plugins).toEqual({ announcer: { enabled: true }, viewer: { enabled: true } });
  });

  it("runs the installed host.js from the cache, with no node_modules to resolve koffi from", async () => {
    await install(FIXTURE_PLUGINS);
    const reinstalled = JSON.parse(runHost("install", "--catalog", catalog.path)) as InstallReport;
    expect(reinstalled.installed).toEqual([]);
    expect(reinstalled.unavailable).toEqual([]);
    const status = JSON.parse(runHost("status"));
    expect(status.id).toBe("forebay-host");
    expect([...status.active].sort()).toEqual(FIXTURE_PLUGINS);
    expect(status.updates).toBeNull();
    expect(readFileSync(join(places.cache, "bundles", "forebay-host", catalog.hostVersion, "package.json"), "utf8")).toContain("module");
  });

  it("honours a pin on the runtime and records it for the next start to load", async () => {
    await install(FIXTURE_PLUGINS);
    setPortable("plugins.runtime.pin", OLDER_RUNTIME_VERSION);
    const report = await install(FIXTURE_PLUGINS);
    expect(report.installed).toEqual([{ id: "runtime", version: OLDER_RUNTIME_VERSION }]);
    expect(bootLibraries(places.cache, "forebay-host", currentPlatformKey())?.runtime).toBe(OLDER_RUNTIME_VERSION);
  });

  it("installs a plugin asked for by name that the settings do not name, and reports it enabled", async () => {
    await install(["viewer"]);
    const report = await install([], countingFetcher(), ["announcer"]);
    expect(report.installed).toEqual([{ id: "announcer", version: "1.0.0" }]);
    expect(report.enabled).toEqual(["announcer"]);
    expect(settings().plugins).toEqual({ announcer: { enabled: true }, viewer: { enabled: true } });
  });

  it("enables a plugin asked for by name even when the user turned it off", async () => {
    await install(FIXTURE_PLUGINS);
    setPortable("plugins.announcer.enabled", false);
    const report = await install([], countingFetcher(), ["announcer"]);
    expect(report.enabled).toEqual(["announcer"]);
    expect(settings().plugins).toEqual({ announcer: { enabled: true }, viewer: { enabled: true } });
  });

  it("keeps the versions the host scheduled for its next start", async () => {
    recordReferences(places.state, "forebay-host", { run: {}, next: { viewer: "2.0.0" } });
    await install(FIXTURE_PLUGINS);
    const [references] = readReferences(places.state);
    expect(references?.next).toEqual({ viewer: "2.0.0" });
  });

  it("refuses to load a cached koffi whose bytes changed, naming the file", async () => {
    await install(FIXTURE_PLUGINS);
    const triplet = currentPlatformKey().replace("-", "_");
    const native = join(places.cache, "libraries", "koffi", "2.16.3", currentPlatformKey(), "build", "koffi", triplet, "koffi.node");
    const bytes = readFileSync(native);
    bytes[0] = (bytes[0] as number) ^ 0xff;
    writeFileSync(native, bytes);
    const refused = refusedHost("status");
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(`build/koffi/${triplet}/koffi.node`);
  });
});

