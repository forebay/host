import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bundledHost } from "../build/bundle-host.js";
import { sha256Of } from "../cache/sha256.js";
import type { Catalog } from "../catalog/catalog.js";
import { hostLibraryReferences } from "../install/boot-from-cache.js";
import { commandTarget } from "../install/loader-identity.js";
import { recordBootExecutable } from "./boot-executable.js";
import { recordReferences } from "../updates/references.js";
import { sweepCache } from "../updates/sweep.js";
import { writeBootHint } from "./boot-hint.js";
import { bootEntryFile, installBootEntry } from "./boot-install.js";

const HOST = "forebay-host";
const PLATFORM = "linux-x64";
const REINSTALL_FIX = "run forebay-host install --catalog <path or url> again";
const LIBRARIES = { runtime: "0.1.0", koffi: "2.0.0" };

let builtBundle: string;
let base: string;
let cache: string;
let state: string;

function fakeHostSource(version: string): string {
  return `export async function runHostCommandLine(argv) { process.stdout.write(JSON.stringify({ version: ${JSON.stringify(version)}, argv })); return 0; }\n`;
}

function installLibrary(id: string, version: string): void {
  const directory = join(cache, "libraries", id, version, PLATFORM);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, ".installed.json"), JSON.stringify({ files: {} }));
}

function installFakeHost(version: string): string {
  const directory = join(cache, "bundles", HOST, version);
  mkdirSync(directory, { recursive: true });
  const files = { "host.js": fakeHostSource(version), "package.json": '{"type":"module"}\n' };
  for (const [name, text] of Object.entries(files)) writeFileSync(join(directory, name), text);
  writeFileSync(join(directory, "boot.js"), readFileSync(join(builtBundle, "boot.js")));
  const hashes = Object.fromEntries(Object.entries(files).map(([name, text]) => [name, sha256Of(Buffer.from(text))]));
  writeFileSync(join(directory, ".installed.json"), JSON.stringify({ files: hashes }));
  return directory;
}

function runBoot(...argv: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [bootEntryFile(cache), ...argv], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function catalogWithLatest(latest: Record<string, string>): Catalog {
  const items: Catalog["items"] = {};
  for (const [id, version] of Object.entries(latest)) items[id] = { kind: "library", latest: version, versions: { [version]: { files: {} } } };
  return { format: 1, items };
}

function startOnce(): void {
  const references = hostLibraryReferences({ cache, state, hostId: HOST, catalog: catalogWithLatest(LIBRARIES), settings: {}, loaded: LIBRARIES, running: { [HOST]: "1.0.0" }, platformKey: PLATFORM });
  recordReferences(state, HOST, references);
}

function scheduleUpdate(version: string): void {
  installFakeHost(version);
  recordReferences(state, HOST, { run: { [HOST]: "1.0.0" }, next: { [HOST]: version } });
}

beforeAll(async () => {
  builtBundle = mkdtempSync(join(tmpdir(), "host-boot-bundle-"));
  await bundledHost(builtBundle);
});

afterAll(() => {
  rmSync(builtBundle, { recursive: true, force: true });
});

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "host-boot-entry-"));
  cache = join(base, "cache");
  state = join(base, "state");
  installLibrary("runtime", LIBRARIES.runtime);
  installLibrary("koffi", LIBRARIES.koffi);
  installBootEntry(cache, installFakeHost("1.0.0"));
  recordBootExecutable(cache, process.execPath);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("the boot entry", () => {
  it("runs the version the hint names, then the scheduled one after the host started once", () => {
    startOnce();
    expect(JSON.parse(runBoot(HOST, "status").stdout)).toEqual({ version: "1.0.0", argv: ["status"] });

    scheduleUpdate("2.0.0");
    startOnce();

    expect(JSON.parse(runBoot(HOST, "launch", "cc").stdout)).toEqual({ version: "2.0.0", argv: ["launch", "cc"] });
  });

  it("leaves everything the hint and the command shim name after a sweep", () => {
    installFakeHost("3.0.0");
    scheduleUpdate("2.0.0");
    startOnce();
    recordReferences(state, HOST, { run: {}, next: {} });

    sweepCache(cache, state);

    const { target, arguments: shimArguments } = commandTarget(cache, "claude-code-loader");
    expect([target, shimArguments[0]].every((path) => existsSync(path as string))).toBe(true);
    expect(existsSync(join(cache, "bundles", HOST, "2.0.0", "host.js"))).toBe(true);
    expect(existsSync(join(cache, "libraries", "runtime", LIBRARIES.runtime, PLATFORM))).toBe(true);
    expect(existsSync(join(cache, "libraries", "koffi", LIBRARIES.koffi, PLATFORM))).toBe(true);
    expect(JSON.parse(runBoot(HOST, "status").stdout).version).toBe("2.0.0");
  });

  it("refuses with the reinstall fix when there is no hint", () => {
    const result = runBoot(HOST, "status");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(REINSTALL_FIX);
    expect(result.stdout).toBe("");
  });

  it("refuses with the reinstall fix when the hint is corrupt, never picking an installed version", () => {
    mkdirSync(join(cache, "hosts"), { recursive: true });
    writeFileSync(join(cache, "hosts", `${HOST}.json`), "{ not json");
    const result = runBoot(HOST, "status");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(REINSTALL_FIX);
    expect(result.stdout).toBe("");
  });

  it("refuses a hint that names a version outside the bundles folder", () => {
    writeBootHint(cache, HOST, LIBRARIES, "../../escape");
    const result = runBoot(HOST, "status");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is not a version");
  });

  it("refuses a host bundle whose file no longer has its hash", () => {
    startOnce();
    writeFileSync(join(cache, "bundles", HOST, "1.0.0", "host.js"), fakeHostSource("tampered"));
    const result = runBoot(HOST, "status");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(REINSTALL_FIX);
    expect(result.stdout).toBe("");
  });

  it("refuses when the version the hint names is not installed", () => {
    writeBootHint(cache, HOST, LIBRARIES, "9.9.9");
    const result = runBoot(HOST, "status");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(REINSTALL_FIX);
  });
});

describe("installBootEntry", () => {
  it("writes boot.js with a module marker beside it", () => {
    expect(readFileSync(join(cache, "boot", "package.json"), "utf8")).toBe('{"type":"module"}\n');
    expect(readFileSync(bootEntryFile(cache))).toEqual(readFileSync(join(builtBundle, "boot.js")));
  });

  it("replaces an entry that differs and leaves one that matches untouched", () => {
    const bundleDirectory = join(cache, "bundles", HOST, "1.0.0");
    writeFileSync(bootEntryFile(cache), "stale");
    installBootEntry(cache, bundleDirectory);
    expect(readFileSync(bootEntryFile(cache))).toEqual(readFileSync(join(builtBundle, "boot.js")));

    const settled = new Date(2020, 0, 1);
    utimesSync(bootEntryFile(cache), settled, settled);
    installBootEntry(cache, bundleDirectory);
    expect(statSync(bootEntryFile(cache)).mtime).toEqual(settled);
  });

  it("refuses a bundle that carries no boot entry", () => {
    const directory = join(base, "bare");
    mkdirSync(directory);
    expect(() => installBootEntry(cache, directory)).toThrow(/carries no boot.js/);
  });
});

describe("commandTarget", () => {
  it("names the runtime executable install recorded and the versionless entry, never a version", () => {
    expect(commandTarget(cache, "cc-loader")).toEqual({ target: process.execPath, arguments: [bootEntryFile(cache), HOST, "launch", "cc-loader"] });
  });
});
