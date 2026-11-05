import type { PluginSecrets } from "@weivel/typescript";
import { HostRefusal } from "../host-refusal.js";
import type { Runtime } from "../runtime/open.js";
import type { HostPlaces } from "./places.js";

/** Answers the answer unchanged, or throws when the store answered a refusal, so a refusal is never read as an absent or stored secret. */
function unrefused<Answer>(answer: Answer): Answer {
  const { refused, fix } = answer as { refused?: unknown; fix?: unknown };
  if (typeof refused === "string") throw new HostRefusal(refused, typeof fix === "string" ? fix : "check the secret store, then retry");
  return answer;
}

export function buildSecrets(runtime: Runtime, places: HostPlaces, pluginId: string): PluginSecrets {
  const scope = { places, plugin: pluginId };
  return {
    get: async (name) => unrefused(runtime.secrets.get({ ...scope, name })).value,
    set: async (name, value) => {
      unrefused(runtime.secrets.set({ ...scope, name, value }));
    },
    delete: async (name) => {
      unrefused(runtime.secrets.delete({ ...scope, name }));
    },
  };
}
