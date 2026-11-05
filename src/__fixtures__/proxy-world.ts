import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { currentPlatformKey } from "@weivel/typescript/host";
import { bundlePlugin } from "../build/bundle-plugin.js";
import { openRuntime, siblingRuntime } from "../runtime/open.js";
import { userHomeOf } from "../user-home.js";
import { REPOSITORY_ROOT } from "./context.js";
import { builtCatalog, environmentUnder, runForebayHost } from "./javascript-host-world.js";
import { pluginRepository } from "./plugin-repository.js";

export const SESSION_HOST = "forebay-host";
export const FRONT_DOOR = "fixture-front-door";
export const PROVIDERS = ["provider-a", "provider-b"];

const START_TIMEOUT_MILLISECONDS = 60000;
const FIXTURE_VERSION = "1.0.0";
/** Longer than any test that holds a live run, so its record never goes stale under it. */
const LIVE_RUN_MILLISECONDS = 600000;

/** A temp machine with the foundation, a fixture front door and two fixture providers installed from a local catalog. */
export interface ProxyWorld {
  base: string;
  environment: Record<string, string>;
  state: string;
  hostEntry: string;
  providerLog: string;
  port: number;
}

/** A session host running the world's registered host in a node process of its own. */
export interface RunningSession {
  process: ChildProcess;
  stderr(): string;
  stop(): Promise<{ code: number | null; stderr: string }>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address !== null ? resolve(address.port) : reject(new Error("no port"))));
    });
  });
}

function providerRepository(base: string, id: string, version: string): string {
  const manifest = id === "provider-a" ? { version } : {
    version,
    id,
    services: { provides: [`${id}:accounts`], consumes: ["accounts"] },
    actions: { login: { label: "Log in", call: { service: `${id}:accounts`, method: "login", argument: { label: "default" } } } },
  };
  return pluginRepository(join(base, "repositories", `${id}-${version}`), "provider-a", { manifest });
}

async function bundledPlugins(base: string, providerAVersion: string): Promise<string[]> {
  const front = join(base, "stage", FRONT_DOOR);
  await bundlePlugin(pluginRepository(join(base, "repositories", FRONT_DOOR), FRONT_DOOR), front);
  const providers: string[] = [];
  for (const id of PROVIDERS) {
    const version = id === "provider-a" ? providerAVersion : FIXTURE_VERSION;
    const out = join(base, "stage", `${id}-${version}`);
    await bundlePlugin(providerRepository(base, id, version), out);
    providers.push(out);
  }
  return [front, ...providers];
}

/** Rebuilds the world's catalog in place with provider-a at `version`, so an update check would find it. */
export async function publishProviderA(world: ProxyWorld, version: string): Promise<void> {
  await builtCatalog(world.base, currentPlatformKey(), await bundledPlugins(world.base, version));
}

/** Writes a setting of the session host through the runtime, as a user changing it would. */
export function setHostSetting(world: ProxyWorld, key: string, value: unknown, layer: "application" | "portable" = "application"): void {
  const runtime = openRuntime(siblingRuntime(REPOSITORY_ROOT));
  try {
    const places = runtime.places.resolve({ home: userHomeOf(world.environment), environment: world.environment });
    const home = runtime.registry.get({ places, id: SESSION_HOST }).registration?.home;
    if (typeof home !== "string") throw new Error(`${SESSION_HOST} is not registered`);
    runtime.settings.set({ home, portable: places.portable, key, value, layer });
  } finally {
    runtime.close();
  }
}

/**
 * Records a run of the session host from this live process, as a session running beside the test
 * would, answering what removes it again.
 */
export function holdLiveRun(world: ProxyWorld): () => void {
  const runtime = openRuntime(siblingRuntime(REPOSITORY_ROOT));
  const { record } = runtime.processes.recordRun({ state: world.state, hostId: SESSION_HOST, run: { [SESSION_HOST]: FIXTURE_VERSION }, checkMilliseconds: LIVE_RUN_MILLISECONDS });
  return () => {
    try {
      runtime.processes.removeRuns({ state: world.state, hostId: SESSION_HOST, record });
    } finally {
      runtime.close();
    }
  };
}

/** Builds the catalog, installs every fixture plugin and points the session host's proxy at a free port. */
export async function installedProxyWorld(): Promise<ProxyWorld> {
  const base = mkdtempSync(join(tmpdir(), "host-proxy-"));
  const environment = environmentUnder(base);
  mkdirSync(environment.TEMP as string, { recursive: true });
  const { catalog, javascriptHostVersion } = await builtCatalog(base, currentPlatformKey(), await bundledPlugins(base, FIXTURE_VERSION));
  runForebayHost({ base, environment }, ["install", "--catalog", catalog, ...[FRONT_DOOR, ...PROVIDERS].flatMap((id) => ["--plugin", id])]);
  const state = environment.SPISOR_STATE as string;
  const hostEntry = join(environment.SPISOR_CACHE as string, "bundles", "javascript-host", javascriptHostVersion, "host.js");
  const world = { base, environment, state, hostEntry, providerLog: join(base, "provider.log"), port: await freePort() };
  setHostSetting(world, "proxy.port", world.port);
  return world;
}

function driverOf(world: ProxyWorld): string {
  const driver = join(world.base, "session-driver.mjs");
  writeFileSync(
    driver,
    [
      `const host = await import(${JSON.stringify(pathToFileURL(world.hostEntry).href)});`,
      `const session = await host.runSessionHost(${JSON.stringify(SESSION_HOST)});`,
      'process.stdout.write("started\\n");',
      'process.stdin.on("data", async () => { await session.stop(); process.exit(0); });',
    ].join("\n"),
  );
  return driver;
}

/** Starts the session host in its own node process, answering once it has started or refusing with what it wrote. */
export function startSession(world: ProxyWorld, environment: Record<string, string> = {}): Promise<RunningSession> {
  const child = spawn(process.execPath, [driverOf(world)], { cwd: world.base, env: { ...world.environment, FIXTURE_PROVIDER_LOG: world.providerLog, ...environment }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
  const session: RunningSession = {
    process: child,
    stderr: () => stderr,
    stop: async () => {
      child.stdin.write("stop\n");
      return { code: await exited, stderr };
    },
  };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the session host did not start: ${stderr}`)), START_TIMEOUT_MILLISECONDS);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.includes("started")) {
        clearTimeout(timer);
        resolve(session);
      }
    });
    void exited.then((code) => {
      clearTimeout(timer);
      reject(new Error(`the session host exited with ${code}: ${stderr}`));
    });
  });
}

/** The ready record the session host published, `<state>/processes/<host>.ready.json`. */
export function readyRecord(world: ProxyWorld): Record<string, unknown> | undefined {
  const file = join(world.state, "processes", `${SESSION_HOST}.ready.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : undefined;
}

/** What the fixture providers recorded: one `{provider, model, event}` per line. */
export function providerEvents(world: ProxyWorld): Array<{ provider: string; model: string; event: string }> {
  if (!existsSync(world.providerLog)) return [];
  return readFileSync(world.providerLog, "utf8").split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as { provider: string; model: string; event: string });
}
