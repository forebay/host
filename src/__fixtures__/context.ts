import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PluginManifest } from "@weivel/typescript";
import type { RuntimeEvents } from "@weivel/typescript/engine";
import type { ActivityRecord } from "../context/activity.js";
import type { HostIdentity } from "../identity.js";
import { openRuntime, siblingRuntime } from "../runtime/open.js";
import type { Runtime, RuntimeSource } from "../runtime/open.js";
import type { HostPlaces } from "../context/places.js";

export const REPOSITORY_ROOT = resolve(import.meta.dirname, "..", "..");

export interface Fixture {
  base: string;
  source: RuntimeSource;
  runtime: Runtime;
  places: HostPlaces;
  host: HostIdentity;
  activity: ActivityRecord[];
  bus: RuntimeEvents;
  dispose(): void;
}

function recordingBus(records: Fixture["activity"]): RuntimeEvents {
  return {
    publish: (topic, payload) => {
      if (topic === "activity") records.push(payload as ActivityRecord);
    },
    subscribe: () => () => {},
  };
}

export function createFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), "host-context-"));
  const source = siblingRuntime(REPOSITORY_ROOT);
  const runtime = openRuntime(source);
  const places = runtime.places.resolve({
    home: join(base, "user"),
    environment: {
      SPISOR_HOME: join(base, "portable"),
      SPISOR_STATE: join(base, "state"),
      SPISOR_CACHE: join(base, "cache"),
      SPISOR_SECRETS: join(base, "secrets"),
    },
  });
  const activity: Fixture["activity"] = [];
  const host: HostIdentity = { id: "test-host", version: "1.0.0", home: join(base, "home"), requiresCommand: false, commands: [] };
  return {
    base,
    source,
    runtime,
    places,
    host,
    activity,
    bus: recordingBus(activity),
    dispose: () => {
      runtime.close();
      rmSync(base, { recursive: true, force: true });
    },
  };
}

export function manifestOf(id: string, extra: Partial<PluginManifest> = {}): PluginManifest {
  return { id, api: 2, ...extra };
}
