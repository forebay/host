import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPlugins } from "@weivel/typescript/host";
import type { PluginHostOptions } from "@weivel/typescript/host";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileFixtureBundles } from "./__fixtures__/bundles.js";
import { REPOSITORY_ROOT } from "./__fixtures__/context.js";
import type { HostIdentity } from "./identity.js";
import { directoryBundles } from "./plugins/bundle-source.js";
import { openRuntime, siblingRuntime } from "./runtime/open.js";
import { startHost } from "./start.js";
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
    running = await startHost(options(), {
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
    running = await startHost(options(), { reconcileSecrets: async () => ({ failed: "no secret store" }) });
    await Promise.resolve();
    expect(running.status().secrets).toEqual({ failed: "no secret store" });
  });

  it("answers no secrets outcome while the reconcile is still running", async () => {
    running = await startHost(options(), {
      reconcileSecrets: (_source, _places, signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve({ failed: "stopped" }))),
    });
    expect(running.status().secrets).toBeNull();
  });

  it("stops the reconcile worker when the host stops", async () => {
    const signals: AbortSignal[] = [];
    const host = await startHost(options(), {
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
    const host = await startHost(options(), {
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

  it("stops twice without failing", async () => {
    enable("a");
    const host = await started();
    await host.stop();
    await expect(host.stop()).resolves.toBeUndefined();
  });
});
