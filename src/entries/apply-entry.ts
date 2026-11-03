import type { HostPlaces } from "../context/places.js";
import type { Runtime } from "../runtime/open.js";
import { claudeCodeEntry } from "./claude-code.js";
import type { EntryLoader, EntryWriter } from "./entry-change.js";
import { openCodeEntry } from "./opencode.js";

/** Keyed by the application id a loader's standard names, so an application this host has no entry for simply gets none. */
const ENTRY_WRITERS: Readonly<Record<string, EntryWriter>> = {
  claude: claudeCodeEntry,
  opencode: openCodeEntry,
};

/** What writing one loader's application entry did: the sequence of each change the runtime recorded, or why there is no entry. */
export type ApplicationEntry = { written: true; sequences: number[] } | { written: false; detail: string };

/**
 * Makes `loader`'s application start the loader's host through its own plugin mechanism, every file,
 * directory and settings member through `changes.apply` under the loader's id, so removing the
 * loader reverses all of it.
 *
 * @remarks A change already on disk is not recorded again, so writing the entry twice changes nothing.
 * An application with no entry writer is answered, not refused.
 */
export function writeApplicationEntry(runtime: Runtime, places: HostPlaces, loader: EntryLoader): ApplicationEntry {
  const writer = Object.hasOwn(ENTRY_WRITERS, loader.application.id) ? ENTRY_WRITERS[loader.application.id] : undefined;
  if (writer === undefined) return { written: false, detail: `this host writes no entry for the application ${loader.application.id}, so it starts only through the launcher` };
  const sequences = writer(places, loader).flatMap((change) => {
    const { recorded, sequence } = runtime.changes.apply({ places, host: loader.id, change });
    return recorded && sequence !== undefined ? [sequence] : [];
  });
  return { written: true, sequences };
}
