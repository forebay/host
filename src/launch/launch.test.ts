import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readBootHint } from "../boot/boot-hint.js";
import { bootEntryFile } from "../boot/boot-install.js";
import { openCacheSession } from "../cli/cache-session.js";
import { REPOSITORY_ROOT } from "../__fixtures__/context.js";
import type { EcosystemCatalog } from "../__fixtures__/ecosystem-catalog.js";
import { fakeApplicationStart, installFakeApplication, releaseFakeApplication, SIGNALS_VARIABLE, windowsSystemVariables } from "../__fixtures__/fake-application.js";
import type { FakeApplicationStart } from "../__fixtures__/fake-application.js";
import { APPLICATION_ID, BACKGROUND_ID, installLaunchEcosystem, launchCatalog, LOADER_ID } from "../__fixtures__/launch-ecosystem.js";
import type { LaunchEcosystem } from "../__fixtures__/launch-ecosystem.js";
import type { Catalog } from "../catalog/catalog.js";
import { hostsApi } from "../hosts.js";
import { forebayHostHome } from "../install/forebay-host.js";
import { emptyReport } from "../install/install-report.js";
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

/** Pins the loader to `version` in the portable settings, as a user holding it to a version the catalog does not list would. */
function pinLoader(version: string): void {
  const runtime = openRuntime(siblingRuntime(REPOSITORY_ROOT));
  try {
    const { places } = installed();
    runtime.settings.set({ home: forebayHostHome(places), portable: places.portable, key: `plugins.${LOADER_ID}.pin`, value: version, layer: "portable" });
  } finally {
    runtime.close();
  }
}

function recordedProvenance(): unknown {
  const runtime = openRuntime(siblingRuntime(REPOSITORY_ROOT));
  try {
    return (runtime.registry.get({ places: installed().places, id: LOADER_ID }).registration?.application as { provenance?: unknown } | undefined)?.provenance;
  } finally {
    runtime.close();
  }
}

function launcherEnvironment(path: string): Record<string, string> {
  return { ...installed().environment, PATH: path, [SIGNALS_VARIABLE]: signals, ...windowsSystemVariables() };
}

function runHook(): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [bootEntryFile(installed().places.cache), "forebay-host", "hook", LOADER_ID, "session-start"], { cwd: tmpdir(), env: launcherEnvironment(join(base, "bin")), encoding: "utf8", timeout: START_TIMEOUT });
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

/** The pid the launcher spawned for the application: the application itself, or on Windows the command shell running its wrapper. */
function applicationChildPid(started: FakeApplicationStart): number {
  return process.platform === "win32" ? started.parent : started.pid;
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
    const launcher = launch(["only", "7", "--keep"]);
    const started = await applicationStarted("only");
    const background = await backgroundHeldBy(2);

    expect(started.argv).toEqual(["only", "7", "--keep"]);
    expect(readHolders(state(), BACKGROUND_ID).holders).toEqual([launcher.child.pid, applicationChildPid(started)]);
    expect(isProcessAlive(background)).toBe(true);
    expect(readHostReferences(state(), LOADER_ID).run[LOADER_ID]).toBe("1.0.0");

    releaseFakeApplication(signals, "only");

    expect(await launcher.exit).toBe(7);
    await gone(background, INTERVAL * 2 + STOP_ALLOWANCE);
    expect(existsSync(holdersFile(state(), BACKGROUND_ID))).toBe(false);
  });

  it("hands the application every argument after the loader id unchanged, a leading -- included", async () => {
    const launcher = launch(["--", "0", "x"]);
    const started = await applicationStarted("--");

    expect(started.argv).toEqual(["--", "0", "x"]);
    releaseFakeApplication(signals, "--");
    expect(await launcher.exit).toBe(0);
  });

  it("shares one background process between two launchers, kept by the first's exit and stopped by the second's", async () => {
    const first = launch(["first", "0"]);
    await applicationStarted("first");
    const background = await backgroundHeldBy(2);
    const second = launch(["second", "0"]);
    const secondStarted = await applicationStarted("second");
    expect(await backgroundHeldBy(4)).toBe(background);

    releaseFakeApplication(signals, "first");
    expect(await first.exit).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, INTERVAL * 3));
    expect(isProcessAlive(background)).toBe(true);
    expect(readHolders(state(), BACKGROUND_ID)).toMatchObject({ pid: background, holders: [second.child.pid, applicationChildPid(secondStarted)] });

    releaseFakeApplication(signals, "second");
    expect(await second.exit).toBe(0);
    await gone(background, INTERVAL * 2 + STOP_ALLOWANCE);
    const left = [first.child.pid, second.child.pid, background, ...startedApplicationPids()].filter((pid) => pid !== undefined && isProcessAlive(pid));
    expect(left).toEqual([]);
  });

  it.runIf(process.platform === "win32")("on Windows, where the launcher's job takes its direct child with it, leaves the application running and the background host exiting within two intervals of a hard kill", async () => {
    const launcher = launch(["orphaned", "0"]);
    const started = await applicationStarted("orphaned");
    const background = await backgroundHeldBy(2);

    const killedAt = Date.now();
    hardKill(launcher.child.pid as number);
    await gone(background, INTERVAL * 2 + STOP_ALLOWANCE);

    expect(Date.now() - killedAt).toBeLessThan(INTERVAL * 2 + STOP_ALLOWANCE);
    expect(isProcessAlive(started.pid)).toBe(true);
  });

  it.skipIf(process.platform === "win32")("keeps the background host for an application whose launcher is killed hard, and stops it within two intervals of the application exiting", async () => {
    const launcher = launch(["orphaned", "0"]);
    const started = await applicationStarted("orphaned");
    const background = await backgroundHeldBy(2);

    hardKill(launcher.child.pid as number);
    await new Promise((resolve) => setTimeout(resolve, INTERVAL * 3));
    expect(isProcessAlive(started.pid)).toBe(true);
    expect(isProcessAlive(background)).toBe(true);
    expect(readHolders(state(), BACKGROUND_ID)).toMatchObject({ pid: background, holders: [applicationChildPid(started)] });

    const releasedAt = Date.now();
    releaseFakeApplication(signals, "orphaned");
    await gone(background, INTERVAL * 2 + STOP_ALLOWANCE);
    expect(Date.now() - releasedAt).toBeLessThan(INTERVAL * 2 + STOP_ALLOWANCE);
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
    pinLoader("2.0.0");
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

  it("keeps the version a launch switched to when a later hook records the loader, so a sweep never deletes what launch runs", async () => {
    const bundles = join(installed().places.cache, "bundles", LOADER_ID);
    cpSync(join(bundles, "1.0.0"), join(bundles, "2.0.0"), { recursive: true });
    pinLoader("2.0.0");
    recordReferences(state(), LOADER_ID, { run: { [LOADER_ID]: "1.0.0" }, next: { [LOADER_ID]: "2.0.0" } });
    const switching = launch(["switched", "0"]);
    await applicationStarted("switched");
    releaseFakeApplication(signals, "switched");
    expect(await switching.exit).toBe(0);

    const hook = runHook();
    expect({ status: hook.status, stdout: hook.stdout, stderr: hook.stderr }).toEqual({ status: 0, stdout: "", stderr: "" });

    expect(readHostReferences(state(), LOADER_ID).run[LOADER_ID]).toBe("2.0.0");
    expect(registeredVersion(LOADER_ID)).toBe("2.0.0");
    sweepCache(installed().places.cache, state());
    expect(existsSync(join(bundles, "2.0.0"))).toBe(true);
  });

  it("keeps the application's provenance across a launch and a hook, so the application is still updated through its recorded method", async () => {
    ecosystem = await installLaunchEcosystem(base, catalog, { "processes.holderCheckMilliseconds": INTERVAL }, undefined, { method: "fake", package: "fixture-pkg" });
    const installedProvenance = recordedProvenance();
    expect(installedProvenance).toMatchObject({ method: "fake", package: "fixture-pkg" });

    const launcher = launch(["provenance", "0"]);
    await applicationStarted("provenance");
    releaseFakeApplication(signals, "provenance");
    expect(await launcher.exit).toBe(0);
    expect(runHook().status).toBe(0);

    expect(recordedProvenance()).toEqual(installedProvenance);
    const reached = new Error("the recorded method's provider was reached");
    const route = { host: { start: async (): Promise<never> => Promise.reject(reached), installProvider: async () => emptyReport() }, catalog: { items: {} } as unknown as Catalog };
    const runtime = openRuntime(siblingRuntime(REPOSITORY_ROOT));
    try {
      await expect(hostsApi(runtime, installed().places, installed().environment).updateApplication(LOADER_ID, route)).rejects.toBe(reached);
    } finally {
      runtime.close();
    }
  });

  it("writes the boot entry only from the forebay-host version the boot hint names, so an older session never puts its own back", () => {
    const { cache } = installed().places;
    const hosts = join(cache, "bundles", "forebay-host");
    cpSync(join(hosts, catalog.hostVersion), join(hosts, "0.0.1"), { recursive: true });
    writeFileSync(join(hosts, "0.0.1", "boot.js"), "// an older boot entry\n");

    openCacheSession(join(hosts, "0.0.1", "host.js"), installed().environment);

    expect(readBootHint(cache, "forebay-host")?.host).toBe(catalog.hostVersion);
    expect(readFileSync(bootEntryFile(cache))).toEqual(readFileSync(join(hosts, catalog.hostVersion, "boot.js")));
  });

  it.skipIf(process.platform === "win32")("passes a SIGTERM on to the application and answers 128 plus its number", async () => {
    const launcher = launch(["terminated", "0"]);
    const started = await applicationStarted("terminated");
    const background = await backgroundHeldBy(2);

    launcher.child.kill("SIGTERM");

    expect(await launcher.exit).toBe(143);
    expect(isProcessAlive(started.pid)).toBe(false);
    await gone(background, INTERVAL * 2 + STOP_ALLOWANCE);
  });
});
