import type { LoadedHost } from "@weivel/typescript/host";
import type { ReconcileAnswer } from "./context/reconcile-worker.js";
import type { MissingPlugin } from "./plugins/resolve.js";

export interface HostStatus {
  id: string;
  active: string[];
  quarantined: Array<{ id: string; detail: string; fix: string }>;
  missing: Array<{ id: string; fix: string }>;
  /** How the start's secrets reconcile ended, `{ failed }` included, or null while it still runs. */
  secrets: ReconcileAnswer | null;
}

export function statusOf(id: string, loaded: LoadedHost, missing: readonly MissingPlugin[], secrets: ReconcileAnswer | null): HostStatus {
  return {
    id,
    active: [...loaded.started],
    quarantined: loaded.quarantined.map(({ pluginId, detail, fix }) => ({ id: pluginId, detail, fix })),
    missing: missing.map(({ id: missingId, fix }) => ({ id: missingId, fix })),
    secrets,
  };
}
