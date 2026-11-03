import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readBootHint } from "../boot/boot-hint.js";
import { bootEntryFile } from "../boot/boot-install.js";
import { REPOSITORY_ROOT } from "../__fixtures__/context.js";
import type { EcosystemCatalog } from "../__fixtures__/ecosystem-catalog.js";
import { fakeApplicationStart, installFakeApplication, releaseFakeApplication, SIGNALS_VARIABLE, windowsSystemVariables } from "../__fixtures__/fake-application.js";
import type { FakeApplicationStart } from "../__fixtures__/fake-application.js";
import { APPLICATION_ID, BACKGROUND_ID, installLaunchEcosystem, launchCatalog, LOADER_ID } from "../__fixtures__/launch-ecosystem.js";
import type { LaunchEcosystem } from "../__fixtures__/launch-ecosystem.js";
import { holdersFile, isProcessAlive, readHolders } from "../processes/holders.js";
import { openRuntime, siblingRuntime } from "../runtime/open.js";
import { readHostReferences, recordReferences, removeHostReferences } from "../updates/references.js";
import { sweepCache } from "../updates/sweep.js";

const INTERVAL = 500;
/** What a background host may take beyond its holder checks to stop its plugins and exit. */
const STOP_ALLOWANCE = 2500;
const START_TIMEOUT = 30000;

interface Launcher {
  child: ChildProcess;
  exit: Promise<number>;
  stderr: () => string;
}

let workspace: string | undefined;
let catalog: EcosystemCatalog;
let base: string;
let signals: string;
let ecosystem: LaunchEcosystem | undefined;
let launchers: Launcher[];
let backgroundPids: Set<number>;

function installed(): LaunchEcosystem {
  if (ecosystem === undefined) throw new Error("the launch ecosystem was not installed");
  return ecosystem;
}

function state(): string {
  return installed().places.state;
}

function registeredVersion(id: string): unknown {
  const runtime = openRuntime(siblingRuntime(REPOSITORY_ROOT));
  try {
    return runtime.registry.get({ places: installed().places, id }).registration?.version;
  } finally {
    runtime.close();
  }
}

function launcherEnvironment(path: string): Record<string, string> {
  return { ...installed().environment, PATH: path, [SIGNALS_VARIABLE]: signals, ...windowsSystemVariables() };
}

function launch(applicationArguments: string[], path = join(base, "bin")): Launcher {
  const child = spawn(process.execPath, [bootEntryFile(installed().places.cache), "forebay-host", "launch", LOADER_ID, ...applicationArguments], {
    cwd: tmpdir(),
    env: launcherEnvironment(path),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.stdout?.resume();
  const exit = new Promise<number>((resolve) => child.once("exit", (code, signal) => resolve(code ?? (signal === null ? -1 : 128))));
  const launcher = { child, exit, stderr: () => stderr };
  launchers.push(launcher);
  return launcher;
}

async function until<T>(check: () => T | undefined, milliseconds: number, what: string): Promise<T> {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const value = check();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${what} did not happen within ${milliseconds} ms`);
}

function applicationStarted(tag: string): Promise<FakeApplicationStart> {
  return until(() => fakeApplicationStart(signals, tag), START_TIMEOUT, `the application ${tag} starting`);
}

/** The background host's pid once the holders file names it with `count` holders. */
function backgroundHeldBy(count: number): Promise<number> {
  return until(
    () => {
      const record = readHolders(state(), BACKGROUND_ID);
      if (record.pid !== null) backgroundPids.add(record.pid);
      return record.pid !== null && record.holders.length === count ? record.pid : undefined;
    },
    START_TIMEOUT,
    `the background host held by ${count}`,
  );
}

function gone(pid: number, milliseconds: number): Promise<true> {
  return until(() => (isProcessAlive(pid) ? undefined : true), milliseconds, `process ${pid} exiting`);
}

function hardKill(pid: number): void {
  if (process.platform === "win32") process.kill(pid);
  else process.kill(pid, "SIGKILL");
}

function killIfAlive(pid: number | null | undefined): void {
  if (pid === null || pid === undefined || !isProcessAlive(pid)) return;
  try {
    hardKill(pid);
  } catch {
    return;
  }
}

/** @implNote Windows releases a killed process's loaded libraries a moment after it reports the process gone, and the cache holds the runtime it loaded. */
async function removeOnceReleased(directory: string): Promise<void> {
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      rmSync(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

function startedApplicationPids(): number[] {
  if (!existsSync(signals)) return [];
  return readdirSync(signals)
    .filter((name) => name.endsWith(".started"))
    .flatMap((name) => {
      const started = fakeApplicationStart(signals, name.slice(0, -".started".length));
      return started === undefined ? [] : [started.pid, started.parent];
    });
}

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), "host-launch-catalog-"));
  catalog = await launchCatalog(workspace);
}, 120000);

afterAll(() => {
  if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true });
});

beforeEach(async () => {
  ecosystem = undefined;
  base = mkdtempSync(join(tmpdir(), "host-launch-"));
  signals = join(base, "signals");
  mkdirSync(signals);
  launchers = [];
  backgroundPids = new Set();
  installFakeApplication(join(base, "bin"), APPLICATION_ID);
  ecosystem = await installLaunchEcosystem(base, catalog, { "processes.holderCheckMilliseconds": INTERVAL });
}, 120000);

function recordedBackgroundPid(): number | null {
  return ecosystem === undefined ? null : readHolders(ecosystem.places.state, BACKGROUND_ID).pid;
}

async function stopEverythingStarted(): Promise<void> {
  const pids = [...launchers.map((launcher) => launcher.child.pid), ...startedApplicationPids(), recordedBackgroundPid(), ...backgroundPids].filter((pid): pid is number => pid !== undefined && pid !== null);
  for (const pid of pids) killIfAlive(pid);
  await Promise.all(launchers.map((launcher) => launcher.exit));
  await Promise.all(pids.map((pid) => gone(pid, 10000)));
}

afterEach(async () => {
  try {
    await stopEverythingStarted();
  } finally {
    await removeOnceReleased(base);
  }
});

describe("forebay-host launch, through the boot entry and the real host bundle", () => {
  it("starts the background host, runs the application with its arguments, and answers its exit code, the background host stopping itself within two intervals", async () => {
    const launcher = launch(["--", "only", "7", "--keep"]);
    const started = await applicationStarted("only");
    const background = await backgroundHeldBy(1);

    expect(started.argv).toEqual(["only", "7", "--keep"]);
    expect(readHolders(state(), BACKGROUND_ID).holders).toEqual([launcher.child.pid]);
    expect(isProcessAlive(background)).toBe(true);
    expect(readHostReferences(state(), LOADER_ID).run[LOADER_ID]).toBe("1.0.0");

    releaseFakeApplication(signals, "only");

    expect(await launcher.exit).toBe(7);
    await gone(background, INTERVAL * 2 + STOP_ALLOWANCE);
    expect(existsSync(holdersFile(state(), BACKGROUND_ID))).toBe(false);
  });

  it("shares one background process between two launchers, kept by the first's exit and stopped by the second's", async () => {
    const first = launch(["first", "0"]);
    await applicationStarted("first");
    const background = await backgroundHeldBy(1);
    const second = launch(["second", "0"]);
    await applicationStarted("second");
    expect(await backgroundHeldBy(2)).toBe(background);

    releaseFakeApplication(signals, "first");
    expect(await first.exit).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, INTERVAL * 3));
    expect(isProcessAlive(background)).toBe(true);
    expect(readHolders(state(), BACKGROUND_ID)).toMatchObject({ pid: background, holders: [second.child.pid] });

    releaseFakeApplication(signals, "second");
    expect(await second.exit).toBe(0);
    await gone(background, INTERVAL * 2 + STOP_ALLOWANCE);
    const left = [first.child.pid, second.child.pid, background, ...startedApplicationPids()].filter((pid) => pid !== undefined && isProcessAlive(pid));
    expect(left).toEqual([]);
  });

  it("leaves a background host that exits by itself within two intervals when its launcher is killed hard, and leaves the application running", async () => {
    const launcher = launch(["orphaned", "0"]);
    const started = await applicationStarted("orphaned");
    const background = await backgroundHeldBy(1);

    const killedAt = Date.now();
    hardKill(launcher.child.pid as number);
    await gone(background, INTERVAL * 2 + STOP_ALLOWANCE);

    expect(Date.now() - killedAt).toBeLessThan(INTERVAL * 2 + STOP_ALLOWANCE);
    expect(isProcessAlive(started.pid)).toBe(true);
  });

  it("refuses an application that is not on the PATH, leaving nothing held or running", async () => {
    const launcher = launch(["absent", "0"], join(base, "empty-path"));

    expect(await launcher.exit).toBe(1);
    expect(launcher.stderr()).toContain(`${APPLICATION_ID} is not on the PATH`);
    expect(launcher.stderr()).toContain("fix: ");
    expect(existsSync(join(state(), "processes", `${BACKGROUND_ID}.json`))).toBe(false);
  });

  it("runs the loader version its references schedule, keeping the one it ran for rollback until a later start", async () => {
    const bundles = join(installed().places.cache, "bundles", LOADER_ID);
    cpSync(join(bundles, "1.0.0"), join(bundles, "2.0.0"), { recursive: true });
    recordReferences(state(), LOADER_ID, { run: { [LOADER_ID]: "1.0.0" }, next: { [LOADER_ID]: "2.0.0" } });
    removeHostReferences(state(), "forebay-host");

    const switching = launch(["switching", "0"]);
    await applicationStarted("switching");
    const switched = readHostReferences(state(), LOADER_ID);
    expect(switched.run[LOADER_ID]).toBe("2.0.0");
    expect(switched.rollback).toEqual({ [LOADER_ID]: "1.0.0" });
    expect(switched.next[LOADER_ID]).toBeUndefined();
    expect(registeredVersion(LOADER_ID)).toBe("2.0.0");
    const standalone = readHostReferences(state(), "forebay-host");
    expect(standalone.run).toMatchObject({ "forebay-host": catalog.hostVersion, runtime: expect.any(String), koffi: expect.any(String) });
    expect(readBootHint(installed().places.cache, "forebay-host")?.host).toBe(catalog.hostVersion);
    releaseFakeApplication(signals, "switching");
    expect(await switching.exit).toBe(0);
    sweepCache(installed().places.cache, state());
    expect(existsSync(join(bundles, "1.0.0"))).toBe(true);

    const later = launch(["later", "0"]);
    await applicationStarted("later");
    expect(readHostReferences(state(), LOADER_ID).rollback).toBeUndefined();
    releaseFakeApplication(signals, "later");
    expect(await later.exit).toBe(0);
    sweepCache(installed().places.cache, state());
    expect(existsSync(join(bundles, "1.0.0"))).toBe(false);
    expect(existsSync(join(bundles, "2.0.0"))).toBe(true);
  });

  it.skipIf(process.platform === "win32")("passes a SIGTERM on to the application and answers 128 plus its number", async () => {
    const launcher = launch(["terminated", "0"]);
    const started = await applicationStarted("terminated");
    const background = await backgroundHeldBy(1);

    launcher.child.kill("SIGTERM");

    expect(await launcher.exit).toBe(143);
    expect(isProcessAlive(started.pid)).toBe(false);
    await gone(background, INTERVAL * 2 + STOP_ALLOWANCE);
  });
});
