import { join } from "node:path";
import { bootEntryFile } from "../boot/boot-install.js";
import type { HostPlaces } from "../context/places.js";
import { FOREBAY_HOST_ID } from "../install/forebay-host.js";
import { jsonContent } from "./entry-change.js";
import type { EntryChange, EntryLoader } from "./entry-change.js";

const MARKETPLACE_NAME = "spisor";
const PLUGIN_NAME = "spisor";
const MANIFEST_DIRECTORY = ".claude-plugin";
const HOOKS_DIRECTORY = "hooks";
const SETTINGS_FILE = "settings.json";
const HOOK_TIMEOUT_SECONDS = 30;

/** Where the loader's marketplace, which is also its one plugin, lives in spisor's machine state. */
export function claudeCodeEntryDirectory(places: HostPlaces, loaderId: string): string {
  return join(places.state, "entries", loaderId);
}

function marketplace(): unknown {
  return {
    name: MARKETPLACE_NAME,
    owner: { name: "spisor" },
    description: "Starts the spisor host when Claude Code starts",
    plugins: [{ name: PLUGIN_NAME, source: ".", description: "Registers the spisor host each time a session starts" }],
  };
}

function pluginManifest(): unknown {
  return { name: PLUGIN_NAME, description: "Registers the spisor host each time a session starts" };
}

/**
 * @implNote Exec form (`args` present) spawns the JavaScript runtime directly with no shell, so no
 * path is ever quoted for Git Bash or PowerShell, whichever Claude Code would pick on Windows.
 */
function hooks(places: HostPlaces, loaderId: string): unknown {
  const command = { type: "command", command: process.execPath, args: [bootEntryFile(places.cache), FOREBAY_HOST_ID, "hook", loaderId, "session-start"], timeout: HOOK_TIMEOUT_SECONDS };
  return { hooks: { SessionStart: [{ hooks: [command] }] } };
}

function settingsKey(home: string, key: string[], value: unknown): EntryChange {
  return { kind: "json-key", file: join(home, SETTINGS_FILE), key, value, create: true };
}

/**
 * Claude Code's entry: a directory marketplace in the machine state whose one plugin runs `hook`
 * on SessionStart, and the two settings members that make Claude Code know and enable it.
 *
 * @implNote Only `extraKnownMarketplaces.spisor` and `enabledPlugins["spisor@spisor"]` are written
 * into the application's settings, never `hooks`: a json-key change sets its member wholesale, so
 * setting `hooks.SessionStart` would replace the user's own hooks.
 */
export function claudeCodeEntry(places: HostPlaces, loader: EntryLoader): EntryChange[] {
  const root = claudeCodeEntryDirectory(places, loader.id);
  return [
    { kind: "directory", path: join(places.state, "entries") },
    { kind: "directory", path: root },
    { kind: "directory", path: join(root, MANIFEST_DIRECTORY) },
    { kind: "directory", path: join(root, HOOKS_DIRECTORY) },
    { kind: "file", path: join(root, MANIFEST_DIRECTORY, "marketplace.json"), content: jsonContent(marketplace()) },
    { kind: "file", path: join(root, MANIFEST_DIRECTORY, "plugin.json"), content: jsonContent(pluginManifest()) },
    { kind: "file", path: join(root, HOOKS_DIRECTORY, "hooks.json"), content: jsonContent(hooks(places, loader.id)) },
    { kind: "directory", path: loader.home },
    settingsKey(loader.home, ["enabledPlugins", `${PLUGIN_NAME}@${MARKETPLACE_NAME}`], true),
    settingsKey(loader.home, ["extraKnownMarketplaces", MARKETPLACE_NAME], { source: { source: "directory", path: root } }),
  ];
}
