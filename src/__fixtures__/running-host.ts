import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Scheduler } from "@weivel/typescript";
import { startPlugins } from "@weivel/typescript/host";
import { compileFixtureBundles } from "./bundles.js";
import { REPOSITORY_ROOT } from "./context.js";
import type { HostIdentity } from "../identity.js";
import { directoryBundles } from "../plugins/bundle-source.js";
import { openRuntime, siblingRuntime } from "../runtime/open.js";
import { startHostWith } from "../start.js";
import type { RunningHost } from "../start.js";

const SOURCE = siblingRuntime(REPOSITORY_ROOT);
const FIXTURE_IDS = ["a", "viewer", "dormant", "greeter", "rival", "silent"];

/** How many turns of the event loop to wait for a call to schedule its deadline before firing regardless. */
const SCHEDULE_POLL_TURNS = 100;

export interface FixtureHost {
  running: RunningHost;
  dispose(): Promise<void>;
}

/** A clock a test advances by hand, recording every delay it was asked to wait. */
export class HandClock implements Scheduler {
  readonly delays: number[] = [];
  private tasks: Array<() => void> = [];

  schedule(task: () => void, delayMillis: number): () => void {
    this.delays.push(delayMillis);
    this.tasks.push(task);
    return () => {
      this.tasks = this.tasks.filter((candidate) => candidate !== task);
    };
  }

  /** @implNote A call schedules its deadline a few microtasks after it starts, so this yields until one is waiting. */
  async fireOnceScheduled(): Promise<void> {
    for (let attempt = 0; attempt < SCHEDULE_POLL_TURNS && this.tasks.length === 0; attempt++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const due = this.tasks;
    this.tasks = [];
    for (const task of due) task();
  }
}

function environmentUnder(base: string): Record<string, string> {
  return {
    HOME: join(base, "user"),
    USERPROFILE: join(base, "user"),
    SPISOR_HOME: join(base, "portable"),
    SPISOR_STATE: join(base, "state"),
    SPISOR_CACHE: join(base, "cache"),
    SPISOR_SECRETS: join(base, "secrets"),
  };
}

function enable(identity: HostIdentity, environment: Record<string, string>, ids: readonly string[]): void {
  const runtime = openRuntime(SOURCE);
  try {
    const places = runtime.places.resolve({ home: environment.HOME, environment });
    for (const id of ids) {
      runtime.settings.set({ home: identity.home, portable: places.portable, key: `plugins.${id}.enabled`, value: true, layer: "portable" });
    }
  } finally {
    runtime.close();
  }
}

/** Starts a host over the compiled fixture plugins with only `enabled` switched on. */
export async function startFixtureHost(enabled: readonly string[], scheduler?: Scheduler): Promise<FixtureHost> {
  const base = mkdtempSync(join(tmpdir(), "host-ui-"));
  const environment = environmentUnder(base);
  const identity: HostIdentity = { id: "test-host", version: "1.0.0", home: join(base, "home"), requiresCommand: false, commands: [] };
  enable(identity, environment, enabled);
  const running = await startHostWith(
    {
      identity,
      runtime: SOURCE,
      bundles: directoryBundles(compileFixtureBundles(join(base, "bundles"), FIXTURE_IDS)),
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
    },
    { startPlugins: (given) => startPlugins(scheduler ? { ...given, scheduler } : given) },
  );
  return {
    running,
    dispose: async () => {
      try {
        await running.stop();
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  };
}
