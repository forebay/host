import type { UiItem } from "@weivel/typescript/host";
import type { HostScreen } from "./ui/headless.js";
import type { RunningHost } from "./start.js";

/** Answers whether a thing is on this machine. @implNote Cheap by contract: PATH, known locations, the registry, the application's files; never a launch, never the network. */
export interface Detector {
  id: string;
  detect(): boolean;
}

/** @implNote `install` is its own member, so it can never be read as one of the plugin's action ids. */
export type PresentedItem = UiItem & { unavailable?: true; install?: true };

const STATE_ORDER = ["installed", "detected", "available"] as const;

function byId(left: UiItem, right: UiItem): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function firstOccurrence(seen: Set<string>): (entry: UiItem) => boolean {
  return (entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  };
}

/** @implNote The strongest state wins, so an id found in two inputs is one row. */
export function threeStateList(installed: UiItem[], detected: UiItem[], available: UiItem[]): UiItem[] {
  const seen = new Set<string>();
  const rows: UiItem[] = [];
  [installed, detected, available].forEach((group, index) => {
    const fresh = group.filter(firstOccurrence(seen)).sort(byId);
    rows.push(...fresh.map((entry) => ({ ...entry, state: STATE_ORDER[index] })));
  });
  return rows;
}

function installedIds(running: RunningHost): string[] {
  const status = running.status();
  return [...status.active, ...status.quarantined.map(({ id }) => id)];
}

function asItems(ids: string[]): UiItem[] {
  return ids.map((id) => ({ id }));
}

/** @implNote A detector that throws could not say the thing is here, so it counts as not detected rather than failing the list. */
function detects(detector: Detector): boolean {
  try {
    return detector.detect();
  } catch {
    return false;
  }
}

export function pluginList(running: RunningHost, detectors: Detector[]): UiItem[] {
  const installed = installedIds(running);
  const detected = detectors.filter(detects).map(({ id }) => id);
  const available = running.bundles.list().map(({ id }) => id);
  return threeStateList(asItems(installed), asItems(detected), asItems(available));
}

function isUnusable(entry: UiItem): boolean {
  return entry.state === "detected" || entry.state === "available";
}

function asInstallable(entry: UiItem): PresentedItem {
  const { action: _dropped, ...rest } = entry as UiItem & { action?: unknown };
  return { ...rest, unavailable: true, install: true };
}

/** @implNote A row that cannot be used offers only install, so an `action` it carried is dropped by design. */
export function presentItems(items: UiItem[]): PresentedItem[] {
  return items.map((entry) => (isUnusable(entry) ? asInstallable(entry) : entry));
}

/**
 * @implNote Returns a promise to match the other renderers although nothing awaits, so a caller treats every screen alike.
 * A plugin view cannot bind a host list (rule V3), which is why this is a host screen.
 */
export function renderPluginList(running: RunningHost, detectors: Detector[]): Promise<HostScreen> {
  const items = presentItems(pluginList(running, detectors));
  return Promise.resolve({
    kind: "host",
    title: "Plugins",
    nodes: [{ id: "plugins", component: "table", state: "ready", data: { items }, props: {} }],
  });
}
