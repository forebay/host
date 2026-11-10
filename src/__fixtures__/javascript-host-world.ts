import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { currentPlatformKey } from "@weivel/typescript/host";
import { bundleJavascriptHost } from "../build/bundle-javascript-host.js";
import { bundlePlugin } from "../build/bundle-plugin.js";
import { bundleKoffiLibrary } from "../build/koffi-library.js";
import { siblingForebayLibrary } from "../forebay-library/open.js";
import { libraryBinaryName } from "../runtime/cached-runtime.js";
import { REPOSITORY_ROOT } from "./context.js";
import { pluginRepository } from "./plugin-repository.js";

const IS_WINDOWS = process.platform === "win32";
const EXECUTABLE_ENDING = IS_WINDOWS ? ".exe" : "";
const LIBRARY = join(REPOSITORY_ROOT, "siblings", "library");
const BUILT = IS_WINDOWS ? join(LIBRARY, "build", "bin", "Release") : join(LIBRARY, "build", "bin");
const RUNTIME_BINARY = IS_WINDOWS ? "runtime.dll" : process.platform === "darwin" ? "libruntime.dylib" : "libruntime.so";
const FOREBAY_HOST = join(BUILT, `forebay-host${EXECUTABLE_ENDING}`);
const RUN_TIMEOUT_MILLISECONDS = 120000;

/** A temp machine with the native forebay-host installed from a local catalog, the javascript-host and one plugin in it. */
export interface JavascriptHostWorld {
  base: string;
  environment: Record<string, string>;
  cache: string;
  state: string;
  hostEntry: string;
}

function stagedForebayHost(stage: string, platform: string): string {
  const directory = join(stage, "forebay-host");
  mkdirSync(join(directory, platform), { recursive: true });
  writeFileSync(join(directory, "host.json"), JSON.stringify({ id: "forebay-host", version: "1.0.0", runtime: "native", entry: `${platform}/forebay-host${EXECUTABLE_ENDING}` }));
  const executables = [`forebay-host${EXECUTABLE_ENDING}`, `forebay-boot${EXECUTABLE_ENDING}`, ...(IS_WINDOWS ? ["runtime-launcher.exe"] : [])];
  for (const executable of executables) copyFileSync(join(BUILT, executable), join(directory, platform, executable));
  return directory;
}

function stagedRuntimeLibrary(stage: string): string {
  const directory = join(stage, "runtime");
  mkdirSync(directory, { recursive: true });
  copyFileSync(join(LIBRARY, "runtime", "library.json"), join(directory, "library.json"));
  copyFileSync(join(BUILT, RUNTIME_BINARY), join(directory, RUNTIME_BINARY));
  return directory;
}

/** forebay-library as a catalog folder: its declaration, its binary and its contract schemas. */
function stagedForebayLibrary(stage: string, platform: string): string {
  const source = siblingForebayLibrary(REPOSITORY_ROOT);
  const directory = join(stage, "forebay-library");
  mkdirSync(directory, { recursive: true });
  copyFileSync(source.declarationPath, join(directory, "library.json"));
  const binary = libraryBinaryName("forebay_library", platform);
  copyFileSync(join(source.binaryDirectory, binary), join(directory, binary));
  cpSync(source.contractsDirectory, join(directory, "contracts"), { recursive: true });
  return directory;
}

export function environmentUnder(base: string): Record<string, string> {
  const user = join(base, "user");
  const systemRoot = process.env.SystemRoot;
  const system: Record<string, string> = systemRoot === undefined ? {} : { SystemRoot: systemRoot, PATH: `${dirname(process.execPath)};${join(systemRoot, "System32")}` };
  return {
    PATH: dirname(process.execPath),
    ...system,
    HOME: user,
    USERPROFILE: user,
    LOCALAPPDATA: join(user, "local"),
    APPDATA: join(user, "roaming"),
    TEMP: join(base, "temp"),
    TMP: join(base, "temp"),
    TMPDIR: join(base, "temp"),
    SPISOR_HOME: join(base, "portable"),
    SPISOR_STATE: join(base, "state"),
    SPISOR_CACHE: join(base, "cache"),
    SPISOR_SECRETS: join(base, "secrets"),
  };
}

function checked(run: SpawnSyncReturns<string>, what: string): string {
  if (run.status === 0) return run.stdout;
  throw new Error(`${what} answered ${run.status}: ${run.stdout}\n${run.stderr}${run.error === undefined ? "" : `\n${run.error.message}`}`);
}

/** Runs the native forebay-host with `arguments_` in the world's environment. */
export function runForebayHost(world: Pick<JavascriptHostWorld, "environment" | "base">, arguments_: string[]): string {
  return checked(spawnSync(FOREBAY_HOST, arguments_, { cwd: world.base, env: world.environment, encoding: "utf8", timeout: RUN_TIMEOUT_MILLISECONDS }), `forebay-host ${arguments_[0]}`);
}

/** Runs `node` on `arguments_` in the world's environment, answering the whole run. */
export function runNode(world: Pick<JavascriptHostWorld, "environment" | "base">, arguments_: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, arguments_, { cwd: world.base, env: world.environment, encoding: "utf8", timeout: RUN_TIMEOUT_MILLISECONDS });
}

/**
 * Builds a local catalog of the native forebay-host, the runtime, koffi and apps libraries, the
 * javascript-host bundle and the plugin folders `plugins` names, answering its index.
 */
export async function builtCatalog(base: string, platform: string, plugins: string[]): Promise<{ catalog: string; javascriptHostVersion: string }> {
  const stage = join(base, "stage");
  const javascriptHost = await bundleJavascriptHost(join(stage, "javascript-host"));
  const koffi = join(stage, "koffi");
  bundleKoffiLibrary(join(REPOSITORY_ROOT, "node_modules", "koffi"), platform, koffi);
  const catalog = join(base, "catalog");
  runForebayHost({ base, environment: environmentUnder(base) }, [
    "catalog",
    "build",
    ...plugins.flatMap((plugin) => ["--plugin", plugin]),
    "--host",
    dirname(javascriptHost.files["host.json"] as string),
    "--host",
    `${stagedForebayHost(stage, platform)}@${platform}`,
    "--library",
    `runtime=${stagedRuntimeLibrary(stage)}@${platform}`,
    "--library",
    `koffi=${koffi}@${platform}`,
    "--library",
    `forebay-library=${stagedForebayLibrary(stage, platform)}@${platform}`,
    "--out",
    catalog,
  ]);
  return { catalog: join(catalog, "catalog.json"), javascriptHostVersion: javascriptHost.version };
}

/**
 * Builds a local catalog of the foundation and the viewer plugin, then installs it with viewer requested.
 *
 * @implNote The install registers no loader, so it requests no command and never writes the user PATH.
 */
export async function installedWorld(): Promise<JavascriptHostWorld> {
  const base = mkdtempSync(join(tmpdir(), "host-javascript-host-"));
  const environment = environmentUnder(base);
  mkdirSync(environment.TEMP as string, { recursive: true });
  const platform = currentPlatformKey();
  const viewer = join(base, "stage", "viewer");
  await bundlePlugin(pluginRepository(join(base, "repositories", "viewer"), "viewer"), viewer);
  const { catalog, javascriptHostVersion } = await builtCatalog(base, platform, [viewer]);
  runForebayHost({ base, environment }, ["install", "--catalog", catalog, "--plugin", "viewer"]);
  const cache = environment.SPISOR_CACHE as string;
  return { base, environment, cache, state: environment.SPISOR_STATE as string, hostEntry: join(cache, "bundles", "javascript-host", javascriptHostVersion, "host.js") };
}
