import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentPlatformKey } from "@weivel/typescript/host";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REPOSITORY_ROOT } from "../__fixtures__/context.js";
import { installFakeApplication } from "../__fixtures__/fake-application.js";
import { startFixtureHost } from "../__fixtures__/running-host.js";
import type { FixtureHost } from "../__fixtures__/running-host.js";
import { hostDirectoryOutput } from "../build/built-directory.js";
import { buildLocalCatalog } from "../build/local-catalog.js";
import { defaultFetcher } from "../cache/fetcher.js";
import type { Catalog } from "../catalog/catalog.js";
import type { HostPlaces } from "../context/places.js";
import { hostsApi } from "../hosts.js";
import { installCatalog } from "../install/install-catalog.js";
import { installLoaders } from "../install/install-loaders.js";
import { emptyReport } from "../install/install-report.js";
import type { InstallReport } from "../install/install-report.js";
import { resolveMissingApplications } from "../install/missing-applications.js";
import type { MissingApplicationsHost } from "../install/missing-applications.js";
import { openRuntime, siblingRuntime } from "../runtime/open.js";
import type { Runtime } from "../runtime/open.js";
import type { RunningHost } from "../start.js";
import { detectThroughMethods } from "./detect.js";
import { operate } from "./operate.js";

vi.mock("./operate.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./operate.js")>();
  return { ...actual, operate: vi.fn(actual.operate) };
});

const PROVIDER_ID = "fake-install-method";
const SETTLE_MILLISECONDS = 100;
const BINARY = "claude-binary-absent";
const PACKAGES = { fake: "claude-pkg" };
const LOADER_ID = "claude-loader";
const FILE = { url: "https://catalog.test/file", sha256: "0".repeat(64), size: 1 };

let base: string;
let environment: Record<string, string>;
let runtime: Runtime;
let places: HostPlaces;
let fixtures: Map<string, FixtureHost>;
let starts: string[][];
let enabled: string[];

function writeLoader(): string {
  const directory = join(base, "loaders", LOADER_ID);
  mkdirSync(directory, { recursive: true });
  const application = { id: "claude", label: "Claude", binary: BINARY, home: { candidates: ["~/homes/claude"] }, packages: PACKAGES };
  writeFileSync(join(directory, "host.json"), JSON.stringify({ id: LOADER_ID, version: "1.0.0", application, pathCommands: { requested: [], minimum: 0 }, background: [] }));
  return directory;
}

async function catalogWithProvider(): Promise<Catalog> {
  const path = buildLocalCatalog([{ kind: "host", output: hostDirectoryOutput(writeLoader()) }], join(base, "catalog"));
  const catalog = await installCatalog([{ kind: "local", path }], places.cache, emptyReport());
  const provider = { kind: "plugin" as const, latest: "1.0.0", versions: { "1.0.0": { platforms: { [currentPlatformKey()]: { files: { "plugin.json": FILE } } } } }, installMethod: "fake" };
  return { ...catalog, items: { ...catalog.items, [PROVIDER_ID]: provider } };
}

async function fixtureFor(enabledIds: string[]): Promise<FixtureHost> {
  const key = enabledIds.join(",");
  const existing = fixtures.get(key);
  if (existing !== undefined) return existing;
  const created = await startFixtureHost(enabledIds);
  fixtures.set(key, created);
  return created;
}

function missingApplicationsHost(): MissingApplicationsHost {
  return {
    async start(): Promise<RunningHost> {
      starts.push([...enabled]);
      const { running } = await fixtureFor(enabled);
      return { ...running, stop: async () => {} };
    },
    async installProvider(id: string): Promise<InstallReport> {
      enabled.push(id);
      return { ...emptyReport(), installed: [{ id, version: "1.0.0" }], enabled: [id] };
    },
  };
}

async function installApplication(catalog: Catalog, choices: Record<string, string>, pathDirectory?: string): Promise<InstallReport> {
  const report = emptyReport();
  const appEnvironment = { ...environment, PATH: pathDirectory ?? join(base, "no-path") };
  await resolveMissingApplications({ catalog, environment: appEnvironment, choices, ask: async () => undefined }, missingApplicationsHost(), report);
  await installLoaders({ catalog, places, runtimeSource: siblingRuntime(REPOSITORY_ROOT), fetcher: defaultFetcher(), environment: appEnvironment }, report);
  return report;
}

function recordedProvenance(): Record<string, unknown> | undefined {
  return (runtime.registry.get({ places, id: LOADER_ID }).registration?.application as { provenance?: Record<string, unknown> } | undefined)?.provenance;
}

async function storeVersion(): Promise<string | undefined> {
  const { running } = await fixtureFor([PROVIDER_ID]);
  const [detection] = await detectThroughMethods(running, "claude", PACKAGES);
  return detection !== undefined && "answer" in detection && detection.answer.installed ? (detection.answer.version ?? "") : undefined;
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "host-provenance-"));
  const userHome = join(base, "user");
  mkdirSync(userHome, { recursive: true });
  environment = { HOME: userHome, USERPROFILE: userHome, SHELL: "/bin/sh" };
  runtime = openRuntime(siblingRuntime(REPOSITORY_ROOT));
  places = runtime.places.resolve({
    home: userHome,
    environment: { SPISOR_HOME: join(base, "portable"), SPISOR_STATE: join(base, "state"), SPISOR_CACHE: join(base, "cache"), SPISOR_SECRETS: join(base, "secrets") },
  });
  fixtures = new Map();
  starts = [];
  enabled = [PROVIDER_ID];
});

afterEach(async () => {
  runtime.close();
  for (const fixture of fixtures.values()) await fixture.dispose();
  rmSync(base, { recursive: true, force: true });
});

describe("an application's provenance", () => {
  it("records the same shape for an application installed through a provider and one found already present through it", async () => {
    const catalog = await catalogWithProvider();
    await installApplication(catalog, { claude: "fake" });
    const installed = recordedProvenance();
    hostsApi(runtime, places, environment).remove(LOADER_ID);

    await installApplication(catalog, {});
    const found = recordedProvenance();

    expect(installed).toMatchObject({ method: "fake", package: "claude-pkg", version: "1.0.0", os: process.platform, architecture: process.arch });
    expect(Object.keys(found ?? {}).sort()).toEqual(Object.keys(installed ?? {}).sort());
    expect(found).toMatchObject({ method: "fake", package: "claude-pkg", version: "1.0.0" });
    expect(installed?.installedAt).toEqual(expect.any(String));
    expect(installed?.location).toEqual(expect.any(String));
  });

  it("records method path, no package and the binary's resolved path for an application found only on PATH", async () => {
    const catalog = await catalogWithProvider();
    const binDirectory = join(base, "bin");
    installFakeApplication(binDirectory, BINARY);
    enabled = [];

    await installApplication(catalog, {}, binDirectory);

    const recorded = recordedProvenance();
    expect(recorded).toMatchObject({ method: "path", os: process.platform, architecture: process.arch });
    expect(recorded).not.toHaveProperty("package");
    expect(String(recorded?.location).startsWith(binDirectory)).toBe(true);
  });

  it("keeps the first record when a later install finds the application another way", async () => {
    const catalog = await catalogWithProvider();
    await installApplication(catalog, { claude: "fake" });
    const first = recordedProvenance();

    await installApplication(catalog, {});

    expect(recordedProvenance()).toEqual(first);
  });
});

describe("updating and removing an application", () => {
  it("updates through the recorded method and refreshes the recorded version", async () => {
    const catalog = await catalogWithProvider();
    await installApplication(catalog, { claude: "fake" });

    const answer = await hostsApi(runtime, places, environment).updateApplication(LOADER_ID, { host: missingApplicationsHost(), catalog });

    expect(answer).toEqual({ ok: true });
    expect(await storeVersion()).toBe("2.0.0");
    expect(recordedProvenance()).toMatchObject({ method: "fake", package: "claude-pkg", version: "2.0.0" });
  });

  it("removes through the recorded method and leaves the loader registered", async () => {
    const catalog = await catalogWithProvider();
    await installApplication(catalog, { claude: "fake" });

    const answer = await hostsApi(runtime, places, environment).removeApplication(LOADER_ID, { host: missingApplicationsHost(), catalog });

    expect(answer).toEqual({ ok: true });
    expect(await storeVersion()).toBeUndefined();
    expect(runtime.registry.get({ places, id: LOADER_ID }).registration).toBeDefined();
  });

  it("installs the recorded method's provider first when it is absent", async () => {
    const catalog = await catalogWithProvider();
    await installApplication(catalog, { claude: "fake" });
    const { running } = await fixtureFor([PROVIDER_ID]);
    await operate(running, "fake", "install", "claude-pkg");
    enabled = [];
    starts = [];

    const answer = await hostsApi(runtime, places, environment).updateApplication(LOADER_ID, { host: missingApplicationsHost(), catalog });

    expect(answer).toEqual({ ok: true, providerInstalled: PROVIDER_ID });
    expect(starts).toEqual([[], [PROVIDER_ID]]);
    expect(await storeVersion()).toBe("2.0.0");
  });

  it("refuses an update and a remove of a path application, naming where it came from", async () => {
    const catalog = await catalogWithProvider();
    const binDirectory = join(base, "bin");
    installFakeApplication(binDirectory, BINARY);
    enabled = [];
    await installApplication(catalog, {}, binDirectory);
    const api = hostsApi(runtime, places, environment);
    starts = [];

    for (const answer of [await api.updateApplication(LOADER_ID, { host: missingApplicationsHost(), catalog }), await api.removeApplication(LOADER_ID, { host: missingApplicationsHost(), catalog })]) {
      expect(answer).toMatchObject({ ok: false, detail: expect.stringContaining(binDirectory), fix: expect.stringContaining("whatever installed it") });
    }
    expect(starts).toEqual([]);
  });

  it("never removes the application when its loader is removed", async () => {
    const catalog = await catalogWithProvider();
    await installApplication(catalog, { claude: "fake" });
    expect(recordedProvenance()).toMatchObject({ method: "fake", package: "claude-pkg" });
    vi.mocked(operate).mockClear();
    starts = [];

    const removal = hostsApi(runtime, places, environment).remove(LOADER_ID);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MILLISECONDS));

    expect(removal.forgotten).toBe(true);
    expect(vi.mocked(operate).mock.calls.filter(([, , verb]) => verb === "remove")).toEqual([]);
    expect(starts).toEqual([]);
    expect(await storeVersion()).toBe("1.0.0");
  });
});
