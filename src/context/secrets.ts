import type { PluginSecrets } from "@weivel/typescript";
import type { Runtime } from "../runtime/open.js";
import type { HostPlaces } from "./places.js";

export function buildSecrets(runtime: Runtime, places: HostPlaces, pluginId: string): PluginSecrets {
  const scope = { places, plugin: pluginId };
  return {
    get: async (name) => runtime.secrets.get({ ...scope, name }).value,
    set: async (name, value) => {
      runtime.secrets.set({ ...scope, name, value });
    },
    delete: async (name) => {
      runtime.secrets.delete({ ...scope, name });
    },
  };
}
