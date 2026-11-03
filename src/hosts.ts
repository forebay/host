import type { HostPlaces } from "./context/places.js";
import type { Runtime } from "./runtime/open.js";
import { removeHostReferences } from "./updates/references.js";

export interface HostEntry {
  registration: { [key: string]: unknown };
  orphan: boolean;
}

export interface HostRemoval {
  reversed: number;
  drifted: unknown[];
  forgotten: boolean;
}

export interface HostsApi {
  list(): HostEntry[];
  orphans(): HostEntry[];
  remove(id: string): HostRemoval;
  renameCommand(host: string, from: string, to: string): string;
  deleteCommand(host: string, name: string): void;
  addCommand(host: string, home: string, name: string, target: string): string;
}

/**
 * @implNote remove reverses before it forgets, and a reverse that throws propagates, so the
 * registration (and the record of what is left to undo) survives for another attempt. The host's
 * reference file goes after the registration, so a failure before it leaves both for the next attempt.
 */
export function hostsApi(runtime: Runtime, places: HostPlaces, environment: Record<string, string>): HostsApi {
  const list = (): HostEntry[] => runtime.registry.list({ places }).hosts;
  return {
    list,
    orphans: () => list().filter((entry) => entry.orphan),
    remove: (id) => {
      const { reversed, drifted } = runtime.changes.reverse({ places, host: id });
      const { forgotten } = runtime.registry.forget({ places, id });
      removeHostReferences(places.state, id);
      return { reversed, drifted, forgotten };
    },
    renameCommand: (host, from, to) => runtime.commands.rename({ places, environment, host, from, to }).name,
    deleteCommand: (host, name) => {
      runtime.commands.delete({ places, host, name });
    },
    addCommand: (host, home, name, target) => runtime.commands.add({ places, environment, host, home, name, target }).name,
  };
}
