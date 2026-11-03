import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REPOSITORY_ROOT } from "../__fixtures__/context.js";
import { bootEntryFile } from "../boot/boot-install.js";
import type { HostPlaces } from "../context/places.js";
import { hostsApi } from "../hosts.js";
import type { LoaderApplication } from "../loader/standard.js";
import { registerHost } from "../registration.js";
import { openRuntime, siblingRuntime } from "../runtime/open.js";
import type { Runtime } from "../runtime/open.js";
import { writeApplicationEntry } from "./apply-entry.js";
import { claudeCodeEntryDirectory } from "./claude-code.js";
import type { EntryLoader } from "./entry-change.js";
import { openCodeEntryFile } from "./opencode.js";

const LOADER_ID = "entry-loader";
const PROVENANCE = { method: "catalog", version: "1.0.0", location: tmpdir(), os: process.platform, architecture: process.arch, installedAt: "2026-11-03T00:00:00.000Z" };

const HAND_WRITTEN_SETTINGS = [
  "{",
  '    "model":"opus",  "ratio": 1.50,',
  '    "hooks": {"SessionStart": [ {"hooks": [{"type": "command", "command": "echo \\u00e9"}]} ]},',
  '    "enabledPlugins": {',
  '        "other@market": true',
  "    }",
  "}",
  "",
].join("\n");

let base: string;
let runtime: Runtime;
let places: HostPlaces;
let environment: Record<string, string>;

function application(id: string): LoaderApplication {
  return { id, label: id, binary: `${id}-binary-absent`, home: { candidates: [`~/homes/${id}`] }, packages: {} };
}

function loaderFor(applicationId: string, home = join(base, "user", "homes", applicationId)): EntryLoader {
  registerHost(runtime, places, { id: LOADER_ID, version: "1.0.0", home, application: { id: applicationId }, requiresCommand: false, commands: [] }, PROVENANCE, environment);
  return { id: LOADER_ID, application: application(applicationId), home };
}

function remove(): { reversed: number; drifted: unknown[] } {
  return hostsApi(runtime, places, environment).remove(LOADER_ID);
}

/** Every path under `directory`, relative to it, so a test can say a tree came back exactly as it was. */
function treeOf(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, encoding: "utf8" }).sort();
}

function settingsFile(home: string): string {
  return join(home, "settings.json");
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "host-entries-"));
  const userHome = join(base, "user");
  mkdirSync(userHome, { recursive: true });
  environment = { PATH: join(base, "path"), HOME: userHome, USERPROFILE: userHome };
  runtime = openRuntime(siblingRuntime(REPOSITORY_ROOT));
  places = runtime.places.resolve({
    home: userHome,
    environment: { SPISOR_HOME: join(base, "portable"), SPISOR_STATE: join(base, "state"), SPISOR_CACHE: join(base, "cache"), SPISOR_SECRETS: join(base, "secrets") },
  });
  mkdirSync(places.state, { recursive: true });
});

afterEach(() => {
  runtime.close();
  rmSync(base, { recursive: true, force: true });
});

describe("the Claude Code entry", () => {
  it("adds only its two members to a hand-written settings.json, in the file's own style, leaving every other byte, and gives the whole file back on remove", () => {
    const loader = loaderFor("claude");
    mkdirSync(loader.home, { recursive: true });
    writeFileSync(settingsFile(loader.home), HAND_WRITTEN_SETTINGS);

    expect(writeApplicationEntry(runtime, places, loader).written).toBe(true);

    const root = claudeCodeEntryDirectory(places, LOADER_ID);
    const marketplace = JSON.stringify({ source: { source: "directory", path: root } });
    expect(readFileSync(settingsFile(loader.home), "utf8")).toBe(
      [
        "{",
        '    "model":"opus",  "ratio": 1.50,',
        '    "hooks": {"SessionStart": [ {"hooks": [{"type": "command", "command": "echo \\u00e9"}]} ]},',
        '    "enabledPlugins": {',
        '        "other@market": true,',
        '        "spisor@spisor": true',
        "    },",
        `    "extraKnownMarketplaces":{`,
        `        "spisor": ${JSON.stringify(JSON.parse(marketplace), null, 4).split("\n").join("\n        ")}`,
        "    }",
        "}",
        "",
      ].join("\n"),
    );

    expect(remove().drifted).toEqual([]);
    expect(readFileSync(settingsFile(loader.home), "utf8")).toBe(HAND_WRITTEN_SETTINGS);
    expect(existsSync(join(places.state, "entries"))).toBe(false);
  });

  it("writes a directory marketplace whose one plugin runs the hook command through the boot entry, with no shell", () => {
    const loader = loaderFor("claude");
    mkdirSync(loader.home, { recursive: true });
    writeApplicationEntry(runtime, places, loader);

    const root = claudeCodeEntryDirectory(places, LOADER_ID);
    expect(treeOf(root)).toEqual([".claude-plugin", join(".claude-plugin", "marketplace.json"), join(".claude-plugin", "plugin.json"), "hooks", join("hooks", "hooks.json")]);
    expect(JSON.parse(readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8"))).toMatchObject({ name: "spisor", owner: { name: "spisor" }, plugins: [{ name: "spisor", source: "." }] });
    expect(JSON.parse(readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf8"))).toMatchObject({ name: "spisor" });
    expect(JSON.parse(readFileSync(join(root, "hooks", "hooks.json"), "utf8"))).toEqual({
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: process.execPath, args: [bootEntryFile(places.cache), "forebay-host", "hook", LOADER_ID, "session-start"], timeout: 30 }] }] },
    });
  });

  it("creates a settings.json that does not exist, and deletes it again on remove", () => {
    const loader = loaderFor("claude");
    mkdirSync(loader.home, { recursive: true });

    writeApplicationEntry(runtime, places, loader);

    expect(JSON.parse(readFileSync(settingsFile(loader.home), "utf8"))).toEqual({
      extraKnownMarketplaces: { spisor: { source: { source: "directory", path: claudeCodeEntryDirectory(places, LOADER_ID) } } },
      enabledPlugins: { "spisor@spisor": true },
    });
    expect(remove().drifted).toEqual([]);
    expect(treeOf(loader.home)).toEqual([]);
    expect(existsSync(loader.home)).toBe(true);
  });

  it("creates an application home that does not exist, and removes it again on remove", () => {
    const loader = loaderFor("claude");
    mkdirSync(join(loader.home, ".."), { recursive: true });

    writeApplicationEntry(runtime, places, loader);

    expect(existsSync(settingsFile(loader.home))).toBe(true);
    expect(remove().drifted).toEqual([]);
    expect(existsSync(loader.home)).toBe(false);
  });

  it("records nothing more when written twice, and still gives the file back on remove", () => {
    const loader = loaderFor("claude");
    mkdirSync(loader.home, { recursive: true });
    writeFileSync(settingsFile(loader.home), HAND_WRITTEN_SETTINGS);

    const first = writeApplicationEntry(runtime, places, loader);
    const second = writeApplicationEntry(runtime, places, loader);

    expect(first).toMatchObject({ written: true, sequences: expect.arrayContaining([expect.any(Number)]) });
    expect(second).toEqual({ written: true, sequences: [] });
    remove();
    expect(readFileSync(settingsFile(loader.home), "utf8")).toBe(HAND_WRITTEN_SETTINGS);
  });
});

describe("the OpenCode entry", () => {
  it("is one plugin file in the global plugin directory, gone with the directory it created on remove", () => {
    const loader = loaderFor("opencode");
    mkdirSync(loader.home, { recursive: true });
    writeFileSync(join(loader.home, "opencode.json"), "{}\n");

    writeApplicationEntry(runtime, places, loader);

    expect(treeOf(loader.home)).toEqual(["opencode.json", "plugins", join("plugins", `spisor-${LOADER_ID}.js`)]);
    const source = readFileSync(openCodeEntryFile(loader.home, LOADER_ID), "utf8");
    expect(fileURLToPath(JSON.parse(/^const BOOT_ENTRY = (.+);$/m.exec(source)?.[1] ?? "null"))).toBe(bootEntryFile(places.cache));
    expect(source).toContain("export const SpisorHost");
    expect(remove().drifted).toEqual([]);
    expect(treeOf(loader.home)).toEqual(["opencode.json"]);
  });

  it("keeps a plugin directory the user already had, removing only its own file", () => {
    const loader = loaderFor("opencode");
    mkdirSync(join(loader.home, "plugins"), { recursive: true });
    writeFileSync(join(loader.home, "plugins", "mine.js"), "export const Mine = async () => ({});\n");

    writeApplicationEntry(runtime, places, loader);
    remove();

    expect(treeOf(loader.home)).toEqual(["plugins", join("plugins", "mine.js")]);
  });
});

describe("an application with no entry writer", () => {
  it("is answered with why there is no entry, and nothing is written or recorded", () => {
    const loader = loaderFor("elsewhere");

    const entry = writeApplicationEntry(runtime, places, loader);

    expect(entry).toEqual({ written: false, detail: expect.stringContaining("elsewhere"), fix: expect.stringContaining("command") });
    expect(existsSync(loader.home)).toBe(false);
    expect(remove().reversed).toBe(0);
  });
});
