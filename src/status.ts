import type { LedgerRow } from "@weivel/typescript/engine";
import type { LoadedHost } from "@weivel/typescript/host";
import type { ReconcileAnswer } from "./context/reconcile-worker.js";
import type { MissingPlugin } from "./plugins/resolve.js";

export interface StatusRefusal {
  id: string;
  detail: string;
  fix: string;
}

export interface HostStatus {
  id: string;
  active: string[];
  quarantined: StatusRefusal[];
  missing: Array<{ id: string; fix: string }>;
  /** Libraries that could not be acquired or opened, each named by its release or its id. */
  libraries: StatusRefusal[];
  /** How the start's secrets reconcile ended, `{ failed }` included, or null while it still runs. */
  secrets: ReconcileAnswer | null;
}

function brokenPlugins(rows: readonly LedgerRow[]): StatusRefusal[] {
  return rows.flatMap(({ pluginId, status, error }) =>
    status === "broken" ? [{ id: pluginId, detail: error?.detail ?? "", fix: error?.fix ?? "" }] : [],
  );
}

function activePlugins(loaded: LoadedHost, rows: readonly LedgerRow[]): string[] {
  const active = new Set(rows.filter(({ status }) => status === "active").map(({ pluginId }) => pluginId));
  return loaded.started.filter((id) => active.has(id));
}

/** @implNote A library refusal never reaches the ledger, which holds plugins only, so what the ledger lacks is a library. */
function libraryRefusals(loaded: LoadedHost, rows: readonly LedgerRow[]): StatusRefusal[] {
  const plugins = new Set(rows.map(({ pluginId }) => pluginId));
  return loaded.quarantined.filter(({ pluginId }) => !plugins.has(pluginId)).map(({ pluginId, detail, fix }) => ({ id: pluginId, detail, fix }));
}

/** @implNote Read from the ledger rather than `started`, so a plugin quarantined after it started is reported as it stands now. */
export function statusOf(id: string, loaded: LoadedHost, missing: readonly MissingPlugin[], secrets: ReconcileAnswer | null): HostStatus {
  const rows = loaded.host.ledger.entries();
  return {
    id,
    active: activePlugins(loaded, rows),
    quarantined: brokenPlugins(rows),
    missing: missing.map(({ id: missingId, fix }) => ({ id: missingId, fix })),
    libraries: libraryRefusals(loaded, rows),
    secrets,
  };
}
