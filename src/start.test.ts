import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPlugins } from "@weivel/typescript/host";
import type { PluginHostOptions } from "@weivel/typescript/host";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileFixtureBundles } from "./__fixtures__/bundles.js";
import { REPOSITORY_ROOT } from "./__fixtures__/context.js";
import { ACTIVITY_TOPIC } from "./context/activity.js";
import type { ActivityRecord } from "./context/activity.js";
import type { HostIdentity } from "./identity.js";
import { directoryBundles } from "./plugins/bundle-source.js";
import { openRuntime, siblingRuntime } from "./runtime/open.js";
import { startHost, startHostWith } from "./start.js";
import { callBinding } from "./ui/bindings.js";
import type { HostOptions, RunningHost } from "./start.js";

let base: string;
let environment: Record<string, string>;
let identity: HostIdentity;
let running: RunningHost | undefined;

const SOURCE = siblingRuntime(REPOSITORY_ROOT);

function writeSetting(key: string, value: unknown): void {
  const runtime = openRuntime(SOURCE);
  try {
    const places = runtime.places.resolve({ home: environment.HOME, environment });
    runtime.settings.set({ home: identity.home, portable: places.portable, key, value, layer: "portable" });
  } finally {
    runtime.close();
  }
}

function bundlesOf(...ids: string[]): HostOptions["bundles"] {
  return directoryBundles(compileFixtureBundles(join(base, "bundles", ids.join("-")), ids));
}

function options(extra: Partial<HostOptions> = {}): HostOptions {
  return { identity, runtime: SOURCE, bundles: extra.bundles ?? bundlesOf("a", "b", "z"), consumes: ["demo:greeting"], environment, ...extra };
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
  it("starts every bundle it is given, a consumer after the plugin providing what it consumes", async () => {
    expect((await started({ bundles: bundlesOf("a", "b") })).loaded.started).toEqual(["a", "b"]);
  });

  it("orders by what is consumed, not by how the ids sort", async () => {
    expect((await started({ bundles: bundlesOf("b", "z") })).loaded.started).toEqual(["z", "b"]);
  });

  it("answers the started plugins as active and maps a refusal into quarantined", async () => {
    const status = (await started({ bundles: bundlesOf("b"), consumes: [] })).status();
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
    const host = await started({ bundles: bundlesOf("announcer") });
    const heard: ActivityRecord[] = [];
    host.events.subscribe(ACTIVITY_TOPIC, (record) => heard.push(record as ActivityRecord));
    expect(await callBinding(host, "announcer", { service: "announcer:voice", method: "say" })).toMatchObject({ ok: true });
    expect(heard).toEqual([{ source: "announcer", kind: "log.error", detail: { message: "spoken" } }]);
  });

  it("reads and writes the host's settings through the runtime it already holds", async () => {
    writeSetting("theme", "dark");
    const host = await started();
    expect(host.settings.all().theme).toBe("dark");
    host.settings.set("theme", "light", "application");
    host.settings.set("density", "compact");
    expect(host.settings.all()).toMatchObject({ theme: "light", density: "compact" });
  });

  it("stops twice without failing", async () => {
    const host = await started({ bundles: bundlesOf("a") });
    await host.stop();
    await expect(host.stop()).resolves.toBeUndefined();
  });
});
