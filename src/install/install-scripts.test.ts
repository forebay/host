import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { currentPlatformKey } from "@weivel/typescript/host";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { REPOSITORY_ROOT } from "../__fixtures__/context.js";
import { ecosystemCatalog, placesEnvironment } from "../__fixtures__/ecosystem-catalog.js";
import type { EcosystemCatalog } from "../__fixtures__/ecosystem-catalog.js";
import { catalogKeyPatterns } from "./install-script-patterns.js";
import { renderInstallScript } from "./render-install-script.js";
import type { InstallScriptKind } from "./render-install-script.js";
import { COMPATIBLE_RUNTIME_MAJOR, RUNTIME_PIN } from "./runtime-pin.js";
import type { PinnedRuntime } from "./runtime-pin.js";

const IS_WINDOWS = process.platform === "win32";
const SCRIPT_KIND: InstallScriptKind = IS_WINDOWS ? "ps1" : "sh";
const SCRIPT_FILES: Record<InstallScriptKind, string> = { sh: join(REPOSITORY_ROOT, "install", "install.sh"), ps1: join(REPOSITORY_ROOT, "install", "install.ps1") };
const FIXTURE_PLUGINS = ["announcer", "viewer"];
const PLUGIN_ARGUMENTS = FIXTURE_PLUGINS.flatMap((id) => ["--plugin", id]);
const TEST_RUNTIME_VERSION = "99.0.0";
const SCRIPT_TIMEOUT = 300_000;
const runFile = promisify(execFile);
const CATALOG_SCHEMA: unknown = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "catalog.schema.json"), "utf8"));
const UNPACKED_MARKER = ".unpacked";

/** @implNote Without it PowerShell 5.1 takes node.exe for a document and starts it detached, so its output and exit code are lost. */
const WINDOWS_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/** @implNote Every tool the POSIX script calls, linked one by one so the child's PATH holds them and nothing else, node above all. */
const POSIX_TOOLS = ["uname", "mkdir", "rm", "mv", "cut", "tr", "wc", "cat", "curl", "tar", "gzip", "sha256sum", "shasum", "mktemp"];

interface TestRuntime {
  pin: PinnedRuntime;
  served: string;
  stem: string;
}

interface ScriptRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

let workspace: string;
let catalog: EcosystemCatalog;
let runtime: TestRuntime;
let script: string;
let base: string;

function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function whichOf(name: string): string | undefined {
  return (process.env.PATH ?? "").split(delimiter).map((directory) => join(directory, name)).find(isExecutable);
}

function systemRoot(): string {
  return process.env.SystemRoot ?? "C:\\Windows";
}

function windowsTar(): string {
  return join(systemRoot(), "System32", "tar.exe");
}

function powershell(): string {
  return join(systemRoot(), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/**
 * The running node packed the way the pinned archive is laid out, `<stem>/bin/node` in a tar.gz or
 * `<stem>/node.exe` in a zip, beside the other files a real archive carries.
 */
function buildTestRuntime(directory: string): TestRuntime {
  const platform = currentPlatformKey();
  const stem = `test-runtime-${platform}`;
  const stage = join(directory, "stage");
  const binary = IS_WINDOWS ? join(stage, stem, "node.exe") : join(stage, stem, "bin", "node");
  mkdirSync(dirname(binary), { recursive: true });
  copyFileSync(process.execPath, binary);
  chmodSync(binary, 0o755);
  mkdirSync(join(stage, stem, "lib"), { recursive: true });
  writeFileSync(join(stage, stem, "README.md"), "not the runtime");
  writeFileSync(join(stage, stem, "lib", "npm.js"), "not the runtime either");
  const served = join(directory, "served", IS_WINDOWS ? `${stem}.zip` : `${stem}.tar.gz`);
  mkdirSync(dirname(served), { recursive: true });
  if (IS_WINDOWS) execFileSync(windowsTar(), ["--format", "zip", "-cf", served, "-C", stage, stem]);
  else execFileSync("tar", ["-czf", served, "-C", stage, stem]);
  rmSync(stage, { recursive: true, force: true });
  const build = { url: pathToFileURL(served).href, sha256: sha256OfFile(served), archive: IS_WINDOWS ? ("zip" as const) : ("tar.gz" as const) };
  return { pin: { name: "node", version: TEST_RUNTIME_VERSION, platforms: { [platform]: build } }, served, stem };
}

function renderTestScript(directory: string): string {
  const committed = readFileSync(SCRIPT_FILES[SCRIPT_KIND], "utf8");
  const path = join(directory, "script", `install.${SCRIPT_KIND}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderInstallScript(committed, SCRIPT_KIND, runtime.pin, COMPATIBLE_RUNTIME_MAJOR, CATALOG_SCHEMA));
  return path;
}

function linkInto(directory: string, name: string, target: string): void {
  mkdirSync(directory, { recursive: true });
  const link = join(directory, name);
  if (!existsSync(link)) symlinkSync(target, link);
}

function linkTools(directory: string, tools: string[]): string {
  for (const tool of tools) {
    const found = whichOf(tool);
    if (found !== undefined) linkInto(directory, tool, found);
  }
  return directory;
}

function windowsSystemPath(): string {
  const root = systemRoot();
  return [join(root, "System32"), root, join(root, "System32", "WindowsPowerShell", "v1.0")].join(delimiter);
}

interface PathChoice {
  withNode?: boolean;
  withoutCurl?: boolean;
}

/** @implNote No PATH entry of the parent's own, so neither a node on it nor the user's tools leak into the child. */
function pathFor(choice: PathChoice): string {
  if (IS_WINDOWS) return choice.withNode === true ? [windowsSystemPath(), dirname(process.execPath)].join(delimiter) : windowsSystemPath();
  const toolDirectory = choice.withoutCurl === true ? join(base, "tools-without-curl") : join(base, "tools");
  const directories = [linkTools(toolDirectory, POSIX_TOOLS.filter((tool) => choice.withoutCurl !== true || tool !== "curl"))];
  if (choice.withNode === true) {
    const nodeDirectory = join(base, "node-on-path");
    linkInto(nodeDirectory, "node", process.execPath);
    directories.push(nodeDirectory);
  }
  return directories.join(delimiter);
}

function childEnvironment(choice: PathChoice = {}): Record<string, string> {
  const windows: Record<string, string> = IS_WINDOWS ? { SystemRoot: systemRoot(), windir: systemRoot(), PATHEXT: WINDOWS_PATHEXT, LOCALAPPDATA: join(base, "local") } : {};
  return { ...placesEnvironment(base), ...windows, PATH: pathFor(choice) };
}

async function runScript(argv: string[], choice: PathChoice = {}): Promise<ScriptRun> {
  const [command, prefix] = IS_WINDOWS ? [powershell(), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script]] : [whichOf("sh") as string, [script]];
  try {
    const { stdout, stderr } = await runFile(command, [...prefix, ...argv], { cwd: base, env: childEnvironment(choice), encoding: "utf8", timeout: SCRIPT_TIMEOUT, maxBuffer: 64 * 1024 * 1024 });
    return { status: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code: number | null; stdout: string; stderr: string };
    return { status: failed.code, stdout: String(failed.stdout), stderr: String(failed.stderr) };
  }
}

async function install(choice: PathChoice = {}): Promise<ScriptRun> {
  const run = await runScript([catalog.path, ...PLUGIN_ARGUMENTS], choice);
  expect(run, `the script failed:\n${run.stderr}`).toMatchObject({ status: 0 });
  return run;
}

function cache(): string {
  return join(base, "cache");
}

function runtimeDirectory(): string {
  return join(cache(), "runtimes", "node", TEST_RUNTIME_VERSION, currentPlatformKey());
}

function cachedArchive(): string {
  return join(runtimeDirectory(), IS_WINDOWS ? `${runtime.stem}.zip` : `${runtime.stem}.tar.gz`);
}

function unpackedMarker(): string[] {
  return readFileSync(join(runtimeDirectory(), UNPACKED_MARKER), "utf8").split(/\r?\n/).filter((line) => line !== "");
}

function installedRuntime(): string {
  return IS_WINDOWS ? join(runtimeDirectory(), runtime.stem, "node.exe") : join(runtimeDirectory(), runtime.stem, "bin", "node");
}

function hostDirectory(): string {
  return join(cache(), "bundles", "forebay-host", catalog.hostVersion);
}

function status(node: string): { id: string; active: string[] } {
  const env = { ...placesEnvironment(base), ...(IS_WINDOWS ? { SystemRoot: systemRoot() } : {}) };
  return JSON.parse(execFileSync(node, [join(hostDirectory(), "host.js"), "status"], { cwd: base, env, encoding: "utf8" })) as { id: string; active: string[] };
}

function fetchedLines(run: ScriptRun): string[] {
  return `${run.stdout}\n${run.stderr}`.split(/\r?\n/).filter((line) => line.startsWith("fetching "));
}

/** Moves `paths` away while `body` runs, so any attempt to fetch them fails. */
async function withoutSources<T>(paths: string[], body: () => Promise<T>): Promise<T> {
  paths.forEach((path) => renameSync(path, `${path}.away`));
  try {
    return await body();
  } finally {
    paths.forEach((path) => renameSync(`${path}.away`, path));
  }
}

interface HostileCatalog {
  name: string;
  change(files: Record<string, { url: string; sha256: string; size: number }>): void;
}

const HOSTILE_CATALOGS: HostileCatalog[] = [
  { name: "a host bundle that lists no host.js", change: (files) => void delete files["host.js"] },
  { name: "a host bundle that lists no reconcile-worker.js", change: (files) => void delete files["reconcile-worker.js"] },
  { name: "a host bundle that lists no host.json", change: (files) => void delete files["host.json"] },
  { name: "a file key that climbs out of the bundle", change: (files) => void (files["../escape.js"] = { ...(files["host.json"] as { url: string; sha256: string; size: number }) }) },
  { name: "a file url outside the catalog's directory", change: (files) => void ((files["host.js"] as { url: string }).url = "../outside/host.js") },
  { name: "a file whose bytes do not have the listed hash", change: (files) => void ((files["host.js"] as { sha256: string }).sha256 = "0".repeat(64)) },
  { name: "a file that cannot be fetched", change: (files) => void ((files["host.js"] as { url: string }).url = "not-served/host.js") },
  { name: "a file served cut short", change: (files) => void ((files["host.js"] as { url: string }).url = servedCutShort("host.js")) },
  { name: "a file key the schema refuses for ending in a dot", change: (files) => void (files["host.json."] = { ...(files["host.json"] as { url: string; sha256: string; size: number }) }) },
  { name: "two file keys that differ only by case", change: (files) => void (files["HOST.json"] = { ...(files["host.json"] as { url: string; sha256: string; size: number }) }) },
];

/** A copy of the catalog's `key` holding only its first half, served from beside the index, answering its relative url. */
function servedCutShort(key: string): string {
  const whole = readFileSync(join(dirname(catalog.path), "files", "forebay-host", catalog.hostVersion, key));
  const relative = `cut-short/${key}`;
  mkdirSync(join(dirname(catalog.path), "cut-short"), { recursive: true });
  writeFileSync(join(dirname(catalog.path), relative), whole.subarray(0, Math.floor(whole.length / 2)));
  return relative;
}

const BUNDLE_FILE_NAMES = new Set(["host.js", "reconcile-worker.js", "host.json", "package.json", ".installed.json"]);

function strayFiles(directory: string): string[] {
  return existsSync(directory) ? readdirSync(directory).filter((name) => !BUNDLE_FILE_NAMES.has(name)) : [];
}

/** Writes a copy of the catalog index beside it, so its relative urls still resolve, with the forebay-host files changed by `hostile`. */
function hostileCatalog(hostile: HostileCatalog, index: number): string {
  const parsed = JSON.parse(readFileSync(catalog.path, "utf8")) as { items: Record<string, { versions: Record<string, { files: Record<string, { url: string; sha256: string; size: number }> }> }> };
  hostile.change((parsed.items["forebay-host"]?.versions[catalog.hostVersion] as { files: Record<string, { url: string; sha256: string; size: number }> }).files);
  const path = join(dirname(catalog.path), `hostile-${index}.json`);
  writeFileSync(path, JSON.stringify(parsed, null, 2));
  return path;
}

/** A host.js left in the version directory by an earlier install, which records that it ran. */
function plantStaleHost(): string {
  const ran = join(base, "stale-host-ran");
  mkdirSync(hostDirectory(), { recursive: true });
  writeFileSync(join(hostDirectory(), "host.js"), `process.getBuiltinModule("node:fs").writeFileSync(${JSON.stringify(ran)}, "ran");\n`);
  return ran;
}

describe("the committed install scripts", () => {
  it.each(["sh", "ps1"] as const)("carry RUNTIME_PIN and the catalog schema's patterns in install.%s", (kind) => {
    const committed = readFileSync(SCRIPT_FILES[kind], "utf8");
    expect(renderInstallScript(committed, kind, RUNTIME_PIN, COMPATIBLE_RUNTIME_MAJOR, CATALOG_SCHEMA)).toBe(committed);
    for (const build of Object.values(RUNTIME_PIN.platforms)) {
      expect(committed).toContain(build.url);
      expect(committed).toContain(build.sha256);
    }
    for (const pattern of Object.values(catalogKeyPatterns(CATALOG_SCHEMA))) expect(committed).toContain(pattern);
  });

  it.each(["sh", "ps1"] as const)("contain no en or em dash and nothing outside ASCII in install.%s", (kind) => {
    expect(readFileSync(SCRIPT_FILES[kind], "utf8")).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
  });
});

describe(`install.${SCRIPT_KIND} on this machine`, () => {
  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), "host-install-script-"));
    catalog = await ecosystemCatalog(workspace);
    runtime = buildTestRuntime(join(workspace, "runtime"));
    script = renderTestScript(workspace);
  }, SCRIPT_TIMEOUT);

  afterAll(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "host-install-script-run-"));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("acquires the pinned runtime when none is on the PATH, installs the host from the catalog and leaves the plugins active", async () => {
    const run = await install();
    expect(fetchedLines(run).length).toBeGreaterThan(0);
    expect(existsSync(join(hostDirectory(), ".installed.json"))).toBe(true);
    const reported = status(installedRuntime());
    expect(reported.id).toBe("forebay-host");
    expect([...reported.active].sort()).toEqual(FIXTURE_PLUGINS);
  }, SCRIPT_TIMEOUT);

  it("fetches nothing on a second run", async () => {
    await install();
    const hostFiles = join(dirname(catalog.path), "files", "forebay-host");
    const run = await withoutSources([runtime.served, hostFiles], () => install());
    expect(fetchedLines(run)).toEqual([]);
    expect([...status(installedRuntime()).active].sort()).toEqual(FIXTURE_PLUGINS);
  }, SCRIPT_TIMEOUT);

  it("keeps only the runtime's executable, and the archive's hash in place of the archive", async () => {
    await install();
    expect(existsSync(cachedArchive())).toBe(false);
    expect(existsSync(join(runtimeDirectory(), runtime.stem, "README.md"))).toBe(false);
    expect(existsSync(join(runtimeDirectory(), runtime.stem, "lib"))).toBe(false);
    expect(unpackedMarker()).toEqual([runtime.pin.platforms[currentPlatformKey()]?.sha256, sha256OfFile(installedRuntime())]);
    expect(readdirSync(runtimeDirectory()).filter((name) => !name.startsWith(".")).sort()).toEqual([runtime.stem]);
  }, SCRIPT_TIMEOUT);

  it("acquires the runtime again when its executable's bytes changed", async () => {
    await install();
    const bytes = readFileSync(installedRuntime());
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] as number) ^ 0xff;
    writeFileSync(installedRuntime(), bytes);
    const run = await install();
    expect(fetchedLines(run).some((line) => line.includes(`node ${TEST_RUNTIME_VERSION}`))).toBe(true);
    expect(unpackedMarker()[1]).toBe(sha256OfFile(installedRuntime()));
    expect([...status(installedRuntime()).active].sort()).toEqual(FIXTURE_PLUGINS);
  }, SCRIPT_TIMEOUT);

  it("removes the runtime versions no longer pinned when it acquires the pinned one", async () => {
    const stale = join(cache(), "runtimes", "node", "1.0.0", currentPlatformKey());
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, "node"), "an older pin");
    await install();
    expect(existsSync(join(cache(), "runtimes", "node", "1.0.0"))).toBe(false);
    expect(existsSync(installedRuntime())).toBe(true);
  }, SCRIPT_TIMEOUT);

  it("installs from a catalog index that starts with a UTF-8 byte order mark", async () => {
    const path = join(dirname(catalog.path), "with-byte-order-mark.json");
    writeFileSync(path, `\uFEFF${readFileSync(catalog.path, "utf8")}`);
    const run = await runScript([path, ...PLUGIN_ARGUMENTS], { withNode: true });
    expect(run.status, run.stderr).toBe(0);
    expect([...status(process.execPath).active].sort()).toEqual(FIXTURE_PLUGINS);
  }, SCRIPT_TIMEOUT);

  it("uses a compatible runtime on the PATH and downloads none", async () => {
    await install({ withNode: true });
    expect(existsSync(join(cache(), "runtimes"))).toBe(false);
    expect([...status(process.execPath).active].sort()).toEqual(FIXTURE_PLUGINS);
  }, SCRIPT_TIMEOUT);

  it("refuses with the fix when no catalog is given, and writes nothing", async () => {
    const run = await runScript([]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("pass the catalog to install from");
    expect(existsSync(cache())).toBe(false);
  }, SCRIPT_TIMEOUT);

  it.each(HOSTILE_CATALOGS.map((hostile, index) => [hostile.name, hostile, index] as const))("refuses %s and runs nothing", async (_name, hostile, index) => {
    const ran = plantStaleHost();
    const run = await runScript([hostileCatalog(hostile, index), ...PLUGIN_ARGUMENTS], { withNode: true });
    expect(run.status, run.stderr).toBe(1);
    expect(run.stderr).toContain("fix: ");
    expect(existsSync(ran)).toBe(false);
    expect(existsSync(join(hostDirectory(), ".installed.json"))).toBe(false);
    expect(existsSync(join(cache(), "libraries"))).toBe(false);
    expect(existsSync(join(cache(), "bundles", "forebay-host", "escape.js"))).toBe(false);
    expect(strayFiles(hostDirectory())).toEqual([]);
  }, SCRIPT_TIMEOUT);

  it.runIf(IS_WINDOWS)("leaves no preference or variable in the shell that runs it through Invoke-Expression", async () => {
    const command = `$ErrorActionPreference = 'Continue'; Invoke-Expression ([System.IO.File]::ReadAllText('${script}')); Write-Output ('{0}|{1}|{2}' -f $ErrorActionPreference, (Test-Path variable:RuntimeBuilds), $LASTEXITCODE)`;
    const { stdout } = await runFile(powershell(), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: base, env: childEnvironment(), encoding: "utf8", timeout: SCRIPT_TIMEOUT });
    expect(stdout.trim().split(/\r?\n/).pop()).toBe("Continue|False|1");
  }, SCRIPT_TIMEOUT);

  it.skipIf(IS_WINDOWS)("names curl as the one thing to install when it is missing", async () => {
    const run = await runScript([catalog.path], { withoutCurl: true });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("install curl, then run this again");
  }, SCRIPT_TIMEOUT);
});
