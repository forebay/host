import type { SettingsLayer } from "@weivel/typescript";
import type { HostPlaces } from "./context/places.js";
import type { Runtime } from "./runtime/open.js";

/** The host's own settings, merged across its layers, read and written through the runtime the host already holds. */
export interface HostSettings {
  all(): Record<string, unknown>;
  set(key: string, value: unknown, layer?: SettingsLayer): void;
}

export function hostSettings(runtime: Runtime, places: HostPlaces, home: string): HostSettings {
  const scope = () => ({ home, portable: places.portable });
  return {
    all: () => runtime.settings.all(scope()).values,
    set: (key, value, layer) => {
      runtime.settings.set({ ...scope(), key, value, ...(layer === undefined ? {} : { layer }) });
    },
  };
}
