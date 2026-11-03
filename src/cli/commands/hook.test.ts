import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootEntryFile } from "../../boot/boot-install.js";
import { fixturePluginInput } from "../../__fixtures__/ecosystem-catalog.js";
import type { EcosystemCatalog } from "../../__fixtures__/ecosystem-catalog.js";
import { windowsSystemVariables } from "../../__fixtures__/fake-application.js";
import { BACKGROUND_ID, installLaunchEcosystem, launchCatalog, LOADER_ID, SESSION_PLUGIN } from "../../__fixtures__/launch-ecosystem.js";
import type { LaunchEcosystem } from "../../__fixtures__/launch-ecosystem.js";
import { openCodeEntry } from "../../entries/opencode.js";
import { isProcessAlive, readHolders } from "../../processes/holders.js";
import { REPOSITORY_ROOT } from "../../__fixtures__/context.js";
import { openRuntime, siblingRuntime } from "../../runtime/open.js";
import { readHostReferences, recordReferences, removeHostReferences } from "../../updates/references.js";
import { sweepCache } from "../../updates/sweep.js";

const COUNTER_PLUGIN = "counter";
const ACTIVATIONS_VARIABLE = "SPISOR_FIXTURE_ACTIVATIONS";
const INTERVAL = 500;
const START_TIMEOUT = 30000;

let workspace: string | undefined;
let catalog: EcosystemCatalog;
let base: string;
let activations: string;
let ecosystem: LaunchEcosystem;
let started: ChildProcess[];

function environment(): Record<string, string> {
  return { ...ecosystem.environment, PATH: join(base, "bin"), [ACTIVATIONS_VARIABLE]: activations, ...windowsSystemVariables() };
}

function runHook(loaderId: string, event: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [bootEntryFile(ecosystem.places.cache), "forebay-host", "hook", loaderId, event], { cwd: tmpdir(), env: environment(), encoding: "utf8", timeout: START_TIMEOUT });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function registeredVersion(id: string): unknown {
  const runtime = openRuntime(siblingRuntime(REPOSITORY_ROOT));
  try {
    return runtime.registry.get({ places: ecosystem.places, id }).registration?.version;
  } finally {
    runtime.close();
  }
}

function activatingPids(): number[] {
  return existsSync(activations) ? readFileSync(activations, "utf8").split("\n").filter((line) => line !== "").map(Number) : [];
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

/**
 * The OpenCode entry for the fixture loader, written as a `.mjs` file so Node, which cannot run Bun,
 * loads it as the module it is, and a runner that calls it as OpenCode calls a plugin.
 */
function openCodeRunner(): string {
  const [entryChange] = openCodeEntry(ecosystem.places, { id: LOADER_ID, application: { id: "opencode", label: "OpenCode", binary: "opencode", home: { candidates: ["~/.config/opencode"] }, packages: {} }, home: base }).filter((change) => change.kind === "file");
  if (entryChange === undefined || entryChange.kind !== "file") throw new Error("the OpenCode entry wrote no file");
  const plugin = join(base, "opencode-entry.mjs");
  writeFileSync(plugin, entryChange.content);
  const runner = join(base, "run-opencode-entry.mjs");
  writeFileSync(runner, `const plugin = await import(${JSON.stringify(pathToFileURL(plugin).href)});\nconst hooks = await plugin.SpisorHost({});\nprocess.stdout.write(JSON.stringify(hooks));\nsetInterval(() => {}, 1000);\n`);
  return runner;
}

function killIfAlive(pid: number | null | undefined): void {
  if (pid === null || pid === undefined || !isProcessAlive(pid)) return;
  try {
    process.kill(pid);
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

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), "host-hook-catalog-"));
  catalog = await launchCatalog(workspace, [await fixturePluginInput(workspace, COUNTER_PLUGIN)]);
}, 120000);

afterAll(() => {
  if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true });
});

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), "host-hook-"));
  activations = join(base, "activations.txt");
  started = [];
  mkdirSync(join(base, "bin"));
  ecosystem = await installLaunchEcosystem(base, catalog, { "processes.holderCheckMilliseconds": INTERVAL }, [SESSION_PLUGIN, COUNTER_PLUGIN]);
}, 120000);

afterEach(async () => {
  const pids = [...started.map((child) => child.pid), readHolders(ecosystem.places.state, BACKGROUND_ID).pid];
  for (const pid of pids) killIfAlive(pid);
  await until(() => (pids.every((pid) => pid === undefined || pid === null || !isProcessAlive(pid)) ? true : undefined), 10000, "every started process exiting");
  await removeOnceReleased(base);
});

describe("forebay-host hook, through the boot entry and the real host bundle", () => {
  it("registers the loader and records its reference, starting no plugin and printing nothing on stdout", () => {
    removeHostReferences(ecosystem.places.state, LOADER_ID);

    const hook = runHook(LOADER_ID, "session-start");

    expect(hook).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(readHostReferences(ecosystem.places.state, LOADER_ID).run[LOADER_ID]).toBe("1.0.0");
    expect(activatingPids()).toEqual([]);
    expect(readHolders(ecosystem.places.state, BACKGROUND_ID).pid).toBeNull();
  });

  it("registers and records the loader version a start would run, keeping the one it switched from for rollback through a sweep", () => {
    const { cache, state } = ecosystem.places;
    const bundles = join(cache, "bundles", LOADER_ID);
    cpSync(join(bundles, "1.0.0"), join(bundles, "2.0.0"), { recursive: true });
    recordReferences(state, LOADER_ID, { run: { [LOADER_ID]: "1.0.0" }, next: { [LOADER_ID]: "2.0.0" } });

    expect(runHook(LOADER_ID, "session-start")).toEqual({ status: 0, stdout: "", stderr: "" });

    expect(readHostReferences(state, LOADER_ID)).toEqual({ run: { [LOADER_ID]: "2.0.0" }, next: {}, rollback: { [LOADER_ID]: "1.0.0" } });
    expect(registeredVersion(LOADER_ID)).toBe("2.0.0");
    sweepCache(cache, state);
    expect(existsSync(join(bundles, "2.0.0"))).toBe(true);
    expect(existsSync(join(bundles, "1.0.0"))).toBe(true);
  });

  it("writes a refusal and its fix to stderr and still exits 0, so the application always starts", () => {
    const unknownEvent = runHook(LOADER_ID, "session-end");
    const unregistered = runHook("absent-loader", "session-start");

    expect(unknownEvent).toMatchObject({ status: 0, stdout: "" });
    expect(unknownEvent.stderr).toContain('the hook event "session-end" is not one this host answers');
    expect(unknownEvent.stderr).toContain("fix: run the hook with one of: session-start");
    expect(unregistered).toMatchObject({ status: 0, stdout: "" });
    expect(unregistered.stderr).toContain("absent-loader is not registered");
    expect(unregistered.stderr).toContain("fix: ");
    expect(activatingPids()).toEqual([]);
  });
});

describe("the OpenCode entry, run under Node", () => {
  it("starts the loader's host with its session plugins inside the process that loads it, returning its hooks at once and writing nothing else on stdout", async () => {
    const child = spawn(process.execPath, [openCodeRunner()], { cwd: tmpdir(), env: environment(), stdio: ["ignore", "pipe", "pipe"] });
    started.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

    await until(() => (activatingPids().includes(child.pid as number) ? true : undefined), START_TIMEOUT, `the counter plugin activating in the OpenCode process (stderr: ${stderr})`);
    const background = await until(
      () => {
        const record = readHolders(ecosystem.places.state, BACKGROUND_ID);
        return record.holders.length > 0 ? record : undefined;
      },
      START_TIMEOUT,
      "the background host being held",
    );

    await new Promise((resolve) => setTimeout(resolve, INTERVAL * 2));

    expect(background.holders).toEqual([child.pid]);
    expect(stdout).toBe("{}");
  });
});
