import { currentPlatformKey } from "@weivel/typescript/host";
import { describe, expect, it } from "vitest";
import { startFixtureHost } from "../__fixtures__/running-host.js";
import type { Catalog, CatalogItem } from "../catalog/catalog.js";
import type { MethodDetection } from "../methods/detection.js";
import { detectThroughMethods } from "../methods/detect.js";
import type { RunningHost } from "../start.js";
import { emptyReport } from "./install-report.js";
import type { InstallReport } from "./install-report.js";
import { ApplicationChoiceError, checkApplicationIds, parseApplicationChoices, resolveMissingApplications } from "./missing-applications.js";
import type { MissingApplicationsHost } from "./missing-applications.js";

const PROVIDER_ID = "fake-install-method";
const NO_PATH = { PATH: "" };

const APPLICATION = {
  id: "claude",
  label: "Claude",
  binary: "claude-binary-absent",
  home: { candidates: ["~/.claude"] },
  packages: { fake: "claude-pkg", winget: "Anthropic.Claude" },
};

const FILE = { url: "https://catalog.test/file", sha256: "0".repeat(64), size: 1 };

function applicationItem(): CatalogItem {
  return { kind: "host", latest: "1.0.0", versions: { "1.0.0": { files: { "host.js": FILE } } }, application: APPLICATION };
}

function providerItem(platform: string): CatalogItem {
  return { kind: "plugin", latest: "1.0.0", versions: { "1.0.0": { platforms: { [platform]: { files: { "plugin.json": FILE } } } } }, installMethod: "fake" };
}

function catalogListing(providerPlatform: string | undefined): Catalog {
  const items: Catalog["items"] = { claude: applicationItem() };
  if (providerPlatform !== undefined) items[PROVIDER_ID] = providerItem(providerPlatform);
  return { format: 1, items };
}

interface Harness {
  host: MissingApplicationsHost;
  starts: string[][];
  providersInstalled: string[];
  finalDetections: MethodDetection[][];
}

function harness(initiallyEnabled: string[]): Harness {
  const enabled = [...initiallyEnabled];
  const state: Harness = { host: undefined as never, starts: [], providersInstalled: [], finalDetections: [] };
  state.host = {
    async start(): Promise<RunningHost> {
      state.starts.push([...enabled]);
      const fixture = await startFixtureHost(enabled);
      return {
        ...fixture.running,
        stop: async () => {
          state.finalDetections.push(await detectThroughMethods(fixture.running, "claude", APPLICATION.packages));
          await fixture.dispose();
        },
      };
    },
    async installProvider(id: string): Promise<InstallReport> {
      state.providersInstalled.push(id);
      enabled.push(id);
      return { ...emptyReport(), installed: [{ id, version: "1.0.0" }], enabled: [id] };
    },
  };
  return state;
}

function neverAsk(): Promise<string | undefined> {
  throw new Error("nothing should have been asked");
}

function lastDetection(state: Harness): MethodDetection | undefined {
  return state.finalDetections.at(-1)?.find((detection) => detection.method === "fake");
}

describe("resolveMissingApplications", () => {
  it("asks nothing without a terminal, installs nothing and reports the exact flag", async () => {
    const state = harness([PROVIDER_ID]);
    const report = emptyReport();
    const asked: string[] = [];

    await resolveMissingApplications(
      { catalog: catalogListing(undefined), environment: NO_PATH, choices: {}, ask: async (question) => { asked.push(question); return undefined; } },
      state.host,
      report,
    );

    expect(asked).toHaveLength(1);
    expect(report.applications).toEqual([
      {
        id: "claude",
        state: "missing",
        offered: ["fake"],
        flag: "--application claude=fake",
        unavailable: [expect.objectContaining({ method: "winget", detail: expect.stringContaining("winget") })],
      },
    ]);
    expect(lastDetection(state)).toMatchObject({ answer: { installed: false } });
  });

  it("installs through the method a flag names without asking", async () => {
    const state = harness([PROVIDER_ID]);
    const report = emptyReport();

    await resolveMissingApplications({ catalog: catalogListing(undefined), environment: NO_PATH, choices: { claude: "fake" }, ask: neverAsk }, state.host, report);

    expect(report.applications[0]).toMatchObject({ id: "claude", state: "installed", installedThrough: "fake" });
    expect(lastDetection(state)).toMatchObject({ package: "claude-pkg", answer: { installed: true, version: "1.0.0" } });
  });

  it("installs nothing when the flag says skip", async () => {
    const state = harness([PROVIDER_ID]);
    const report = emptyReport();

    await resolveMissingApplications({ catalog: catalogListing(undefined), environment: NO_PATH, choices: { claude: "skip" }, ask: neverAsk }, state.host, report);

    expect(report.applications[0]).toMatchObject({ id: "claude", state: "skipped" });
    expect(lastDetection(state)).toMatchObject({ answer: { installed: false } });
  });

  it("lists the methods in order with skip and installs the one the user numbers", async () => {
    const state = harness([PROVIDER_ID]);
    const report = emptyReport();
    const asked: string[] = [];

    await resolveMissingApplications(
      { catalog: catalogListing(undefined), environment: NO_PATH, choices: {}, ask: async (question) => { asked.push(question); return "1"; } },
      state.host,
      report,
    );

    expect(asked[0]).toContain("claude");
    expect(asked[0]).toMatch(/1\) fake[\s\S]*2\) skip/);
    expect(report.applications[0]).toMatchObject({ state: "installed", installedThrough: "fake" });
  });

  it("skips when the user answers skip", async () => {
    const state = harness([PROVIDER_ID]);
    const report = emptyReport();

    await resolveMissingApplications({ catalog: catalogListing(undefined), environment: NO_PATH, choices: {}, ask: async () => "skip" }, state.host, report);

    expect(report.applications[0]).toMatchObject({ state: "skipped" });
    expect(lastDetection(state)).toMatchObject({ answer: { installed: false } });
  });

  it("installs the chosen method's provider from the catalog first, then the application", async () => {
    const state = harness([]);
    const report = emptyReport();

    await resolveMissingApplications({ catalog: catalogListing(currentPlatformKey()), environment: NO_PATH, choices: { claude: "fake" }, ask: neverAsk }, state.host, report);

    expect(state.providersInstalled).toEqual([PROVIDER_ID]);
    expect(state.starts).toEqual([[], [PROVIDER_ID]]);
    expect(report.installed).toContainEqual({ id: PROVIDER_ID, version: "1.0.0" });
    expect(report.enabled).toContain(PROVIDER_ID);
    expect(report.applications[0]).toMatchObject({ state: "installed", installedThrough: "fake" });
    expect(lastDetection(state)).toMatchObject({ answer: { installed: true } });
  });

  it("reports a method unavailable with the reason when no provider exists anywhere", async () => {
    const state = harness([]);
    const report = emptyReport();

    await resolveMissingApplications({ catalog: catalogListing(undefined), environment: NO_PATH, choices: {}, ask: neverAsk }, state.host, report);

    expect(state.providersInstalled).toEqual([]);
    expect(report.applications).toEqual([
      {
        id: "claude",
        state: "unavailable",
        unavailable: [
          expect.objectContaining({ method: "fake", detail: expect.stringContaining("fake"), fix: expect.any(String) }),
          expect.objectContaining({ method: "winget", detail: expect.stringContaining("winget"), fix: expect.any(String) }),
        ],
      },
    ]);
  });

  it("treats a provider whose bundle is only for another platform as absent", async () => {
    const state = harness([]);
    const report = emptyReport();

    await resolveMissingApplications({ catalog: catalogListing("aix-ppc64"), environment: NO_PATH, choices: {}, ask: neverAsk }, state.host, report);

    expect(report.applications[0]).toMatchObject({ state: "unavailable" });
    expect(state.providersInstalled).toEqual([]);
  });

  it("refuses a flag naming a method that is not offered, listing the ones that are", async () => {
    const state = harness([PROVIDER_ID]);

    const refused = resolveMissingApplications({ catalog: catalogListing(undefined), environment: NO_PATH, choices: { claude: "winget" }, ask: neverAsk }, state.host, emptyReport());

    await expect(refused).rejects.toThrow(ApplicationChoiceError);
    await expect(refused).rejects.toThrow(/fake/);
    expect(state.finalDetections).toHaveLength(1);
  });
});

describe("application flags", () => {
  it("parses repeated id=method values", () => {
    expect(parseApplicationChoices(["claude=fake", "opencode=skip"])).toEqual({ claude: "fake", opencode: "skip" });
  });

  it("refuses a value without a method, and an id given twice", () => {
    expect(() => parseApplicationChoices(["claude"])).toThrow(ApplicationChoiceError);
    expect(() => parseApplicationChoices(["claude=fake", "claude=skip"])).toThrow(/twice/);
  });

  it("refuses an id the catalog lists no application under, naming the ones it does", () => {
    expect(() => checkApplicationIds(catalogListing(undefined), { gemini: "fake" })).toThrow(/claude/);
    expect(() => checkApplicationIds(catalogListing(undefined), { claude: "fake" })).not.toThrow();
  });
});
