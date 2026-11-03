import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPlugins } from "@weivel/typescript/host";
import type { PluginHostOptions } from "@weivel/typescript/host";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileFixtureBundles } from "./__fixtures__/bundles.js";
import { CATALOG_URL, servedCatalog, servingFetcher, servingTransport } from "./__fixtures__/catalog.js";
import type { ServedCatalog } from "./__fixtures__/catalog.js";
import { installVersion } from "./cache/install-version.js";
import { REPOSITORY_ROOT } from "./__fixtures__/context.js";
import { ACTIVITY_TOPIC } from "./context/activity.js";
import type { ActivityRecord } from "./context/activity.js";
import type { HostIdentity } from "./identity.js";
import { directoryBundles } from "./plugins/bundle-source.js";
import { openRuntime, siblingRuntime } from "./runtime/open.js";
import { startHost, startHostWith } from "./start.js";
import { callBinding } from "./ui/bindings.js";
import { checkCatalog } from "./updates/check.js";
import { sweepCache } from "./updates/sweep.js";
import type { CatalogTransport } from "./updates/check.js";
import type { HostOptions, RunningHost } from "./start.js";

type Layer = "portable" | "application";

let base: string;
let environment: Record<string, string>;
let identity: HostIdentity;
let running: RunningHost | undefined;

const SOURCE = siblingRuntime(REPOSITORY_ROOT);

function writeSettings(values: Array<{ key: string; value: unknown; layer: Layer }>): void {
  const runtime = openRuntime(SOURCE);
  try {
    const places = runtime.places.resolve({ home: environment.HOME, environment });
    for (const { key, value, layer } of values) {
      runtime.settings.set({ home: identity.home, portable: places.portable, key, value, layer });
    }
  } finally {
    runtime.close();
  }
}

function enable(...ids: string[]): void {
  writeSettings(ids.map((id) => ({ key: `plugins.${id}.enabled`, value: true, layer: "portable" as const })));
}

function options(extra: Partial<HostOptions> = {}): HostOptions {
  return {
    identity,
    runtime: SOURCE,
    bundles: directoryBundles(compileFixtureBundles(join(base, "bundles"), ["a", "b", "z"])),
    provenance: {
      method: "test",
      version: "1.0.0",
      location: join(base, "installed"),
      os: process.platform,
      architecture: process.arch,
      installedAt: "2026-11-02T00:00:00.000Z",
    },
    consumes: ["demo:greeting"],
    environment,
    ...extra,
  };
}

async function started(extra: Partial<HostOptions> = {}): Promise<RunningHost> {
  running = await startHost(options(extra));
  return running;
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "host-start-"));
  environment = {
    HOME: join(base, "user"),
    USERPROFILE: join(base, "user"),
    SPISOR_HOME: join(base, "portable"),
    SPISOR_STATE: join(base, "state"),
    SPISOR_CACHE: join(base, "cache"),
    SPISOR_SECRETS: join(base, "secrets"),
  };
  identity = { id: "test-host", version: "1.0.0", home: join(base, "home"), requiresCommand: false, commands: [] };
});

afterEach(async () => {
  await running?.stop();
  running = undefined;
  rmSync(base, { recursive: true, force: true });
});

describe("startHost", () => {
  it("starts a consumer after the plugin providing what it consumes", async () => {
    enable("a", "b");
    expect((await started()).loaded.started).toEqual(["a", "b"]);
  });

  it("orders by what is consumed, not by how the ids sort", async () => {
    enable("b", "z");
    expect((await started()).loaded.started).toEqual(["z", "b"]);
  });

  it("does not start a plugin the source holds but the settings do not enable", async () => {
    enable("a");
    const host = await started();
    expect(host.status().active).toEqual(["a"]);
  });

  it("reports an enabled id with no bundle as missing", async () => {
    enable("a", "c");
    expect((await started()).status().missing).toEqual([{ id: "c", fix: "install c, or disable it" }]);
  });

  it("starts the default provider of a service the host consumes when nothing is enabled", async () => {
    const host = await started({ defaults: { "demo:greeting": "a" } });
    expect(host.status().active).toEqual(["a"]);
  });

  it("lets the application layer disable what the portable layer enables", async () => {
    writeSettings([
      { key: "plugins.a.enabled", value: true, layer: "portable" },
      { key: "plugins.a.enabled", value: false, layer: "application" },
    ]);
    expect((await started()).status().active).toEqual([]);
  });

  it("answers the started plugins as active and maps a refusal into quarantined", async () => {
    enable("b");
    const status = (await started({ consumes: [] })).status();
    expect(status.id).toBe("test-host");
    expect(status.active).toEqual([]);
    expect(status.quarantined).toHaveLength(1);
    expect(status.quarantined[0]).toMatchObject({ id: "b" });
    expect(Object.keys(status.quarantined[0]).sort()).toEqual(["detail", "fix", "id"]);
  });

  it("hands startPlugins the libraries folder in the cache place", async () => {
    const handed: PluginHostOptions[] = [];
    running = await startHostWith(options(), {
      startPlugins: (given) => {
        handed.push(given);
        return startPlugins(given);
      },
    });
    expect(handed[0].libraryCache).toBe(join(running.places.cache, "libraries"));
  });

  it("does not start a default provider the settings explicitly disable", async () => {
    writeSettings([{ key: "plugins.a.enabled", value: false, layer: "portable" }]);
    expect((await started({ defaults: { "demo:greeting": "a" } })).status().active).toEqual([]);
  });

  it("answers the secrets reconcile outcome in status once it settles", async () => {
    running = await startHostWith(options(), { reconcileSecrets: async () => ({ failed: "no secret store" }) });
    await Promise.resolve();
    expect(running.status().secrets).toEqual({ failed: "no secret store" });
  });

  it("answers no secrets outcome while the reconcile is still running", async () => {
    running = await startHostWith(options(), {
      reconcileSecrets: (_source, _places, signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve({ failed: "stopped" }))),
    });
    expect(running.status().secrets).toBeNull();
  });

  it("stops the reconcile worker when the host stops", async () => {
    const signals: AbortSignal[] = [];
    const host = await startHostWith(options(), {
      reconcileSecrets: (_source, _places, signal) => {
        signals.push(signal);
        return new Promise((resolve) => signal.addEventListener("abort", () => resolve({ failed: "stopped" })));
      },
    });
    expect(signals[0].aborted).toBe(false);
    await host.stop();
    expect(signals[0].aborted).toBe(true);
  });

  it("still stops the reconcile worker when stopping the plugins throws", async () => {
    const signals: AbortSignal[] = [];
    const host = await startHostWith(options(), {
      startPlugins: async (given) => ({
        ...(await startPlugins(given)),
        stop: async () => {
          throw new Error("a plugin refused to stop");
        },
      }),
      reconcileSecrets: (_source, _places, signal) => {
        signals.push(signal);
        return new Promise((resolve) => signal.addEventListener("abort", () => resolve({ failed: "stopped" })));
      },
    });
    await expect(host.stop()).rejects.toThrow("a plugin refused to stop");
    expect(signals[0].aborted).toBe(true);
  });

  it("hands the activity plugins publish to whoever subscribes on the running host", async () => {
    enable("announcer");
    const host = await started({ bundles: directoryBundles(compileFixtureBundles(join(base, "bundles"), ["announcer"])) });
    const heard: ActivityRecord[] = [];
    host.events.subscribe(ACTIVITY_TOPIC, (record) => heard.push(record as ActivityRecord));
    expect(await callBinding(host, "announcer", { service: "announcer:voice", method: "say" })).toMatchObject({ ok: true });
    expect(heard).toEqual([{ source: "announcer", kind: "log.error", detail: { message: "spoken" } }]);
  });

  it("reads and writes the host's settings through the runtime it already holds", async () => {
    writeSettings([{ key: "theme", value: "dark", layer: "portable" }]);
    const host = await started();
    expect(host.settings.all().theme).toBe("dark");
    host.settings.set("theme", "light", "application");
    host.settings.set("density", "compact");
    expect(host.settings.all()).toMatchObject({ theme: "light", density: "compact" });
  });

  describe("a command the library refuses before writing anything", () => {
    function withRefusedCommand(requiresCommand: boolean): HostIdentity {
      return { ...identity, requiresCommand, commands: [{ name: "not a name", target: join(base, "bin", "thost"), arguments: [] }] };
    }

    it("is recorded and does not stop a host that does not require a command", async () => {
      const host = await started({ identity: withRefusedCommand(false) });
      expect(host.registration.commands).toEqual([]);
      expect(host.registration.refusedCommands).toHaveLength(1);
      expect(host.registration.refusedCommands[0]).toMatchObject({ name: "not a name" });
      expect(host.registration.refusedCommands[0].detail).toContain("not a portable file name");
      expect(host.registration.refusedCommands[0].fix).not.toBe("");
    });

    it("stops the start of a host that requires a command", async () => {
      await expect(startHost(options({ identity: withRefusedCommand(true) }))).rejects.toThrow(/not a portable file name/);
    });
  });

  it("stops twice without failing", async () => {
    enable("a");
    const host = await started();
    await host.stop();
    await expect(host.stop()).resolves.toBeUndefined();
  });
});

describe("a host started from a catalog", () => {
  const SOURCE_OF_CATALOG = { kind: "https" as const, url: CATALOG_URL };

  function served(versions: string[], latest: string): ServedCatalog {
    return servedCatalog(join(base, "served"), "a", versions, latest);
  }

  function answering(catalog: ServedCatalog): ReturnType<typeof servingTransport> {
    return servingTransport(async () => ({ status: 200, body: catalog.index, etag: "\"one\"" }));
  }

  async function preinstalled(catalog: ServedCatalog, version: string): Promise<void> {
    const item = JSON.parse(catalog.index).items.a;
    expect(await installVersion(environment.SPISOR_CACHE, "a", item, version, servingFetcher(catalog))).toMatchObject({ ok: true });
  }

  async function startedFrom(catalog: ServedCatalog, transport: CatalogTransport): Promise<{ host: RunningHost; fetcher: ReturnType<typeof servingFetcher> }> {
    const fetcher = servingFetcher(catalog);
    running = await startHost(options({ bundles: undefined, catalog: { sources: [SOURCE_OF_CATALOG], transport, fetcher } }));
    return { host: running, fetcher };
  }

  async function finished(host: RunningHost): Promise<void> {
    await vi.waitFor(() => expect(host.status().updates?.finished).toBe(true), { timeout: 10_000 });
  }

  it("refuses options that give both bundles and a catalog, or neither", async () => {
    const catalog = { sources: [SOURCE_OF_CATALOG], transport: servingTransport(async () => ({ status: 304 })) };
    await expect(startHost(options({ catalog }))).rejects.toThrow(/exactly one of bundles and catalog/);
    await expect(startHost(options({ bundles: undefined }))).rejects.toThrow(/exactly one of bundles and catalog/);
  });

  it("makes no transport call and fetches nothing on a start inside the interval with nothing to update", async () => {
    enable("a");
    const catalog = served(["1.0.0"], "1.0.0");
    await preinstalled(catalog, "1.0.0");
    await checkCatalog(SOURCE_OF_CATALOG, environment.SPISOR_CACHE, new Date(), 24, answering(catalog));
    const transport = answering(catalog);
    const { host, fetcher } = await startedFrom(catalog, transport);
    expect(host.status().active).toEqual(["a"]);
    await finished(host);
    expect(host.status().updates).toEqual({ checked: [{ kind: "skipped" }], fetched: [], refused: [], interrupted: false, finished: true });
    expect(transport.calls).toBe(0);
    expect(fetcher.urls).toEqual([]);
  });

  it("runs the installed version, fetches a newer latest in the background and runs it on the next start", async () => {
    enable("a");
    const catalog = served(["1.0.0", "2.0.0"], "2.0.0");
    await preinstalled(catalog, "1.0.0");
    const first = await startedFrom(catalog, answering(catalog));
    expect(first.host.status().active).toEqual(["a"]);
    expect(first.host.bundles.locate("a")?.version).toBe("1.0.0");
    await finished(first.host);
    expect(first.host.status().updates?.fetched).toEqual(["a@2.0.0"]);
    await first.host.stop();
    const second = await startedFrom(catalog, answering(catalog));
    expect(second.host.status().active).toEqual(["a"]);
    expect(second.host.bundles.locate("a")?.version).toBe("2.0.0");
    await finished(second.host);
    expect(existsSync(join(environment.SPISOR_CACHE, "bundles", "a", "1.0.0"))).toBe(false);
  });

  it("starts unaffected when the update check fails, and reports the failure", async () => {
    enable("a");
    const catalog = served(["1.0.0"], "1.0.0");
    await preinstalled(catalog, "1.0.0");
    const transport = servingTransport(async () => {
      throw new Error("the network is down");
    });
    const { host } = await startedFrom(catalog, transport);
    expect(host.status().active).toEqual(["a"]);
    await finished(host);
    expect(host.status().updates?.checked).toEqual([{ kind: "failed", detail: expect.stringContaining("the network is down") }]);
  });

  it("reports a damaged installed version, refetches it in the background and runs it on the next start", async () => {
    enable("a");
    const catalog = served(["1.0.0"], "1.0.0");
    await preinstalled(catalog, "1.0.0");
    writeFileSync(join(environment.SPISOR_CACHE, "bundles", "a", "1.0.0", "index.mjs"), "export default {};");
    const first = await startedFrom(catalog, answering(catalog));
    expect(first.host.status().active).toEqual([]);
    expect(first.host.status().bundleProblems).toEqual([expect.objectContaining({ id: "a", version: "1.0.0", file: "index.mjs" })]);
    await finished(first.host);
    expect(first.host.status().updates?.fetched).toEqual(["a@1.0.0"]);
    await first.host.stop();
    const second = await startedFrom(catalog, answering(catalog));
    expect(second.host.status().active).toEqual(["a"]);
    expect(second.host.status().bundleProblems).toEqual([]);
  });

  async function switchedOnNextStart(installed: string, catalog: ServedCatalog, expected: string, betweenStarts: () => void = () => {}): Promise<void> {
    await preinstalled(catalog, installed);
    const first = await startedFrom(catalog, answering(catalog));
    await finished(first.host);
    expect(first.host.status().updates?.fetched).toEqual([`a@${expected}`]);
    await first.host.stop();
    betweenStarts();
    const second = await startedFrom(catalog, answering(catalog));
    expect(second.host.bundles.locate("a")?.version).toBe(expected);
    expect(second.host.status().active).toEqual(["a"]);
  }

  it("runs a pin older than the installed version on the next start", async () => {
    writeSettings([
      { key: "plugins.a.enabled", value: true, layer: "portable" },
      { key: "plugins.a.pin", value: "1.0.0", layer: "portable" },
    ]);
    await switchedOnNextStart("2.0.0", served(["1.0.0", "2.0.0"], "2.0.0"), "1.0.0");
  });

  it("runs a lowered latest on the next start", async () => {
    enable("a");
    await switchedOnNextStart("2.0.0", served(["1.0.0", "2.0.0"], "1.0.0"), "1.0.0");
  });

  it("keeps a version fetched for the next start through another host's sweep in between", async () => {
    enable("a");
    await switchedOnNextStart("2.0.0", served(["1.0.0", "2.0.0"], "1.0.0"), "1.0.0", () => {
      sweepCache(environment.SPISOR_CACHE, environment.SPISOR_STATE);
    });
  });

  it("records the versions it runs as this host's references", async () => {
    enable("a");
    const catalog = served(["1.0.0"], "1.0.0");
    await preinstalled(catalog, "1.0.0");
    await startedFrom(catalog, answering(catalog));
    expect(JSON.parse(readFileSync(join(environment.SPISOR_STATE, "bundles", "test-host.json"), "utf8"))).toEqual({ run: { a: "1.0.0" }, next: {} });
  });

  it("stops while an update check is still waiting on the network", async () => {
    enable("a");
    const catalog = served(["1.0.0"], "1.0.0");
    await preinstalled(catalog, "1.0.0");
    const transport = servingTransport(() => new Promise(() => {}));
    const { host } = await startedFrom(catalog, transport);
    await vi.waitFor(() => expect(transport.calls).toBe(1));
    await expect(host.stop()).resolves.toBeUndefined();
    expect(host.status().updates?.finished).toBe(true);
  });
});
