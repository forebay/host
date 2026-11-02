import type { LoadedHost } from "@weivel/typescript/host";
import type { MissingPlugin } from "./plugins/resolve.js";

export interface HostStatus {
  id: string;
  active: string[];
  quarantined: Array<{ id: string; detail: string; fix: string }>;
  missing: Array<{ id: string; fix: string }>;
}

export function statusOf(id: string, loaded: LoadedHost, missing: readonly MissingPlugin[]): HostStatus {
  return {
    id,
    active: [...loaded.started],
    quarantined: loaded.quarantined.map(({ pluginId, detail, fix }) => ({ id: pluginId, detail, fix })),
    missing: missing.map(({ id: missingId, fix }) => ({ id: missingId, fix })),
  };
}
