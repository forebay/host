import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentPlatformKey } from "@weivel/typescript/host";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { REPOSITORY_ROOT } from "../__fixtures__/context.js";
import { ecosystemCatalog, placesEnvironment } from "../__fixtures__/ecosystem-catalog.js";
import type { EcosystemCatalog } from "../__fixtures__/ecosystem-catalog.js";
import { defaultFetcher } from "../cache/fetcher.js";
import type { Fetcher } from "../cache/fetcher.js";
import type { HostPlaces } from "../context/places.js";
import { openRuntime, siblingRuntime } from "../runtime/open.js";
import { readReferences } from "../updates/references.js";
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

function setEnabled(id: string, enabled: boolean): void {
  const runtime = openRuntime(siblingRuntime(REPOSITORY_ROOT));
  try {
    runtime.settings.set({ home: hostHome(), portable: places.portable, key: `plugins.${id}.enabled`, value: enabled, layer: "portable" });
  } finally {
    runtime.close();
  }
}

function install(defaults: string[], fetcher: Fetcher = countingFetcher()): Promise<InstallReport> {
  return installEcosystem({ catalog: [{ kind: "local", path: catalog.path }], places, home: hostHome(), defaults, fetcher });
}

function ids(report: InstallReport): string[] {
  return report.installed.map(({ id }) => id).sort();
}

/** @implNote Only what the child needs to find its places; no PATH, no NODE_PATH, so nothing resolves through node_modules. */
function childEnvironment(): Record<string, string> {
  const systemRoot = process.env.SystemRoot;
  return { ...environment, ...(systemRoot === undefined ? {} : { SystemRoot: systemRoot }) };
}

function runHost(...argv: string[]): string {
  const hostFile = join(places.cache, "bundles", "forebay-host", catalog.hostVersion, "host.js");
  return execFileSync(process.execPath, [hostFile, ...argv], { cwd: base, env: childEnvironment(), encoding: "utf8" });
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
    expect(report.cached.sort()).toEqual(["announcer@1.0.0", `forebay-host@${catalog.hostVersion}`, "koffi@2.16.3", "runtime@0.1.0", "viewer@1.0.0"]);
    expect(fetcher.count).toBe(0);
  });

  it("leaves a plugin the user disabled between runs disabled", async () => {
    await install(FIXTURE_PLUGINS);
    setEnabled("announcer", false);
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
    expect(readFileSync(join(places.cache, "bundles", "forebay-host", catalog.hostVersion, "package.json"), "utf8")).toContain("module");
  });
});
