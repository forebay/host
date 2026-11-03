import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bootEntryFile } from "../boot/boot-install.js";
import type { HostPlaces } from "../context/places.js";
import { FOREBAY_HOST_ID } from "../install/forebay-host.js";
import type { EntryChange, EntryLoader } from "./entry-change.js";

const PLUGINS_DIRECTORY = "plugins";
const REINSTALL_FIX = "run forebay-host install --catalog <path or url> again";

/** The one file OpenCode loads from its global plugin directory for loader `loaderId`. */
export function openCodeEntryFile(home: string, loaderId: string): string {
  return join(home, PLUGINS_DIRECTORY, `spisor-${loaderId}.js`);
}

/**
 * @implNote The host starts once per process however often OpenCode calls the plugin, and the plugin
 * returns at once, so a slow or refused start never holds OpenCode's own start; a refusal goes to
 * stderr, which OpenCode does not parse.
 */
function pluginSource(places: HostPlaces, loaderId: string): string {
  const constants = [
    `const BOOT_ENTRY = ${JSON.stringify(pathToFileURL(bootEntryFile(places.cache)).href)};`,
    `const HOST_ID = ${JSON.stringify(FOREBAY_HOST_ID)};`,
    `const LOADER_ID = ${JSON.stringify(loaderId)};`,
    `const REINSTALL_FIX = ${JSON.stringify(REINSTALL_FIX)};`,
  ];
  const body = [
    "let started;",
    "",
    "function reportRefusal(error) {",
    "  const detail = error?.detail ?? error?.message ?? String(error);",
    "  process.stderr.write(`spisor did not start ${LOADER_ID}: ${detail}\\nfix: ${error?.fix ?? REINSTALL_FIX}\\n`);",
    "}",
    "",
    "export const SpisorHost = async () => {",
    "  started ??= import(BOOT_ENTRY).then((boot) => boot.runSessionHost(HOST_ID, LOADER_ID)).catch(reportRefusal);",
    "  return {};",
    "};",
  ];
  return `${[...constants, "", ...body].join("\n")}\n`;
}

/** OpenCode's entry: one plugin file in its global plugin directory that runs the loader's host in OpenCode's own process for the session. */
export function openCodeEntry(places: HostPlaces, loader: EntryLoader): EntryChange[] {
  return [
    { kind: "directory", path: loader.home },
    { kind: "directory", path: join(loader.home, PLUGINS_DIRECTORY) },
    { kind: "file", path: openCodeEntryFile(loader.home, loader.id), content: pluginSource(places, loader.id) },
  ];
}
