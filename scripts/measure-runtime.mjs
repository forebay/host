import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transformSync } from "esbuild";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_PLUGINS = ["announcer", "viewer"];
const IDLE_MILLISECONDS = 10_000;
const SAMPLE_OFFSETS = [2_500, 5_000, 7_500];

const PLATFORM_KEY = `${process.platform}-${process.arch}`;

const NODE_VERSION = process.env.MEASURE_NODE_VERSION ?? "26.13.0";
const BUN_VERSION = process.env.MEASURE_BUN_VERSION ?? "1.4.4";

const CANDIDATES = [
  {
    name: "node",
    version: NODE_VERSION,
    archive: () => {
      const version = NODE_VERSION;
      const suffix = { "win32-x64": "win-x64.zip", "linux-x64": "linux-x64.tar.gz", "darwin-x64": "darwin-x64.tar.gz", "darwin-arm64": "darwin-arm64.tar.gz" }[PLATFORM_KEY];
      const file = `node-v${version}-${suffix}`;
      return { file, url: `https://nodejs.org/dist/v${version}/${file}`, sums: `https://nodejs.org/dist/v${version}/SHASUMS256.txt` };
    },
    executable: (root) => (process.platform === "win32" ? findFile(root, "node.exe") : findFile(root, "node")),
  },
  {
    name: "bun",
    version: BUN_VERSION,
    archive: () => {
      const version = BUN_VERSION;
      const target = { "win32-x64": "windows-x64", "linux-x64": "linux-x64", "darwin-x64": "darwin-x64", "darwin-arm64": "darwin-aarch64" }[PLATFORM_KEY];
      const file = `bun-${target}.zip`;
      const base = `https://github.com/oven-sh/bun/releases/download/bun-v${version}`;
      return { file, url: `${base}/${file}`, sums: `${base}/SHASUMS256.txt` };
    },
    executable: (root) => findFile(root, process.platform === "win32" ? "bun.exe" : "bun"),
  },
];

function findFile(root, name) {
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name === name && !entry.parentPath.includes("node_modules")) return join(entry.parentPath, entry.name);
  }
  throw new Error(`no ${name} under ${root}`);
}

function directoryBytes(root) {
  return readdirSync(root, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .reduce((total, entry) => total + statSync(join(entry.parentPath, entry.name)).size, 0);
}

async function download(url, target) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
}

async function publishedSha256(sumsUrl, file) {
  const response = await fetch(sumsUrl);
  if (!response.ok) throw new Error(`${sumsUrl} answered ${response.status}`);
  const line = (await response.text()).split("\n").find((entry) => entry.trim().endsWith(`  ${file}`));
  if (line === undefined) throw new Error(`${sumsUrl} lists no ${file}`);
  return line.split(/\s+/)[0];
}

function sha256Of(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** @implNote On Windows the bsdtar in System32 by its full path, since a GNU tar earlier on PATH reads `C:` as a remote host and cannot open a zip. */
function tarExecutable() {
  return process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
}

function extract(archivePath, into) {
  mkdirSync(into, { recursive: true });
  execFileSync(tarExecutable(), ["-xf", archivePath, "-C", into]);
}

/**
 * @implNote The fixtures import sibling modules by their `.js` name while the files on disk are
 * `.ts`, and the sources use parameter properties Node's type stripping refuses; vitest handles
 * both and plain Node does not, so these hooks resolve and compile the same way, file by file, and
 * the script builds exactly the catalog task 8's test builds.
 */
function resolveTypeScriptSources() {
  registerHooks({
    load(url, context, nextLoad) {
      if (!url.startsWith("file:") || !url.endsWith(".ts")) return nextLoad(url, context);
      const path = fileURLToPath(url);
      const { code } = transformSync(readFileSync(path, "utf8"), { loader: "ts", format: "esm", sourcefile: path, target: "esnext" });
      return { format: "module", source: code, shortCircuit: true };
    },
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        const typeScript = specifier.replace(/\.js$/, ".ts");
        if (error.code !== "ERR_MODULE_NOT_FOUND" || typeScript === specifier) throw error;
        return nextResolve(typeScript, context);
      }
    },
  });
}

function importSource(...segments) {
  return import(pathToFileURL(join(REPOSITORY_ROOT, "src", ...segments)).href);
}

async function buildCatalog(workspace) {
  execFileSync(process.execPath, [join(REPOSITORY_ROOT, "scripts", "embed-catalog-schema.mjs")], { stdio: "inherit" });
  resolveTypeScriptSources();
  const fixtures = await importSource("__fixtures__", "ecosystem-catalog.ts");
  return { ...(await fixtures.ecosystemCatalog(workspace)), placesEnvironment: fixtures.placesEnvironment };
}

/** Installs the catalog into `environment`'s places in this process, as task 8's test does before it runs the installed host. */
async function installInProcess(catalog, environment) {
  const { openRuntime, siblingRuntime } = await importSource("runtime", "open.ts");
  const { installEcosystem } = await importSource("install", "install-ecosystem.ts");
  const { defaultFetcher } = await importSource("cache", "fetcher.ts");
  const runtime = openRuntime(siblingRuntime(REPOSITORY_ROOT));
  let places;
  try {
    places = runtime.places.resolve({ home: environment.HOME, environment });
  } finally {
    runtime.close();
  }
  const home = join(places.state, "home", "forebay-host");
  await installEcosystem({ catalog: [{ kind: "local", path: catalog.path }], places, home, defaults: FIXTURE_PLUGINS, requested: [], fetcher: defaultFetcher() });
}

/** @implNote The same environment task 8's test gives the child: the four places and the user's home, no PATH and no NODE_PATH. */
function childEnvironment(placesEnvironment, base) {
  const systemRoot = process.env.SystemRoot;
  return { ...placesEnvironment(base), ...(systemRoot === undefined ? {} : { SystemRoot: systemRoot }) };
}

function runHost(executable, hostFile, base, environment, argv) {
  return execFileSync(executable, [hostFile, ...argv], { cwd: base, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function describeFailure(error) {
  return [error.message, error.stderr && `stderr: ${String(error.stderr).trim()}`].filter(Boolean).join("\n");
}

/** Installs the catalog with the candidate and runs `status`, as task 8's test does, answering what failed if anything did. */
function runsHostUnchanged(executable, catalog, base, environment) {
  try {
    runHost(executable, hostFileIn(environment, catalog), base, environment, ["install", "--catalog", catalog.path]);
    const status = JSON.parse(runHost(executable, hostFileIn(environment, catalog), base, environment, ["status"]));
    const active = [...status.active].sort();
    if (status.id !== "forebay-host" || JSON.stringify(active) !== JSON.stringify(FIXTURE_PLUGINS)) {
      return { ok: false, detail: `status answered id ${status.id} with active ${JSON.stringify(active)}` };
    }
    return { ok: true, detail: `status answered forebay-host with active ${JSON.stringify(active)}` };
  } catch (error) {
    return { ok: false, detail: describeFailure(error) };
  }
}

function hostFileIn(environment, catalog) {
  return join(environment.SPISOR_CACHE, "bundles", "forebay-host", catalog.hostVersion, "host.js");
}

/**
 * @implNote The host's own `status` stops the moment it has printed, so a wrapper runs the same
 * command with an output that parks the main thread for {@link IDLE_MILLISECONDS} after printing:
 * the host is fully started, its plugins active and its reconcile worker alive, and nothing runs.
 */
function writeIdleWrapper(directory, hostFile) {
  const wrapper = join(directory, "idle-host.mjs");
  writeFileSync(
    wrapper,
    [
      `const { runHostCommandLine } = await import(${JSON.stringify(pathToFileURL(hostFile).href)});`,
      "const output = {",
      "  out(line) {",
      "    process.stdout.write(`${line}\\n`);",
      "    process.stdout.write('IDLE\\n');",
      `    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${IDLE_MILLISECONDS});`,
      "  },",
      "  error: (line) => process.stderr.write(`${line}\\n`),",
      "};",
      'process.exitCode = await runHostCommandLine(["status"], output);',
    ].join("\n"),
  );
  return wrapper;
}

function workingSetBytes(pid) {
  if (process.platform === "win32") {
    return Number(execFileSync("powershell.exe", ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).WorkingSet64`], { encoding: "utf8" }).trim());
  }
  return Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim()) * 1024;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

async function idleWorkingSet(executable, wrapper, base, environment) {
  const child = spawn(executable, [wrapper], { cwd: base, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exited = new Promise((resolve) => child.on("exit", resolve));
  await new Promise((resolve, reject) => {
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("IDLE\n")) resolve();
    });
    child.on("exit", (code) => reject(new Error(`idle host exited ${code} before printing its status\n${stderr}`)));
  });
  const started = Date.now();
  const samples = [];
  for (const offset of SAMPLE_OFFSETS) {
    await delay(Math.max(0, offset - (Date.now() - started)));
    samples.push(workingSetBytes(child.pid));
  }
  await exited;
  return { samples, median: median(samples) };
}

async function measure(candidate, catalog, scratch) {
  const archive = candidate.archive();
  const directory = join(scratch, candidate.name);
  mkdirSync(directory, { recursive: true });
  const archivePath = join(directory, archive.file);
  await download(archive.url, archivePath);
  const published = await publishedSha256(archive.sums, archive.file);
  const actual = sha256Of(archivePath);
  if (published !== actual) throw new Error(`${archive.file} hashes ${actual}, ${archive.sums} publishes ${published}`);
  const unpacked = join(directory, "unpacked");
  extract(archivePath, unpacked);
  const executable = candidate.executable(unpacked);
  const base = mkdtempSync(join(scratch, `${candidate.name}-home-`));
  const environment = childEnvironment(catalog.placesEnvironment, base);
  await installInProcess(catalog, environment);
  const unchanged = runsHostUnchanged(executable, catalog, base, environment);
  const idle = unchanged.ok ? await idleWorkingSet(executable, writeIdleWrapper(directory, hostFileIn(environment, catalog)), base, environment) : undefined;
  return {
    candidate: candidate.name,
    version: candidate.version,
    url: archive.url,
    checksums: archive.sums,
    sha256: published,
    archiveBytes: statSync(archivePath).size,
    unpackedBytes: directoryBytes(unpacked),
    idleWorkingSetSamples: idle?.samples ?? null,
    idleWorkingSetMedian: idle?.median ?? null,
    runsHostUnchanged: unchanged.ok,
    detail: unchanged.detail,
  };
}

/**
 * Downloads each candidate runtime's official build for this platform into a temporary directory,
 * runs task 8's installed host under it, and prints archive bytes, unpacked bytes and the median of
 * three idle working-set samples as JSON. Everything it writes is deleted before it exits.
 */
async function main() {
  const scratch = mkdtempSync(join(tmpdir(), "measure-runtime-"));
  try {
    const catalog = await buildCatalog(join(scratch, "catalog"));
    const results = [];
    for (const candidate of CANDIDATES) results.push(await measure(candidate, catalog, scratch));
    process.stdout.write(`${JSON.stringify({ platform: PLATFORM_KEY, measuredAt: new Date().toISOString(), results }, null, 2)}\n`);
  } finally {
    if (existsSync(scratch)) rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}

await main();
