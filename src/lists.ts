import type { UiItem } from "@weivel/typescript/host";
import type { HeadlessScreen } from "./ui/headless.js";
import type { RunningHost } from "./start.js";

/** Answers whether a thing is on this machine. @implNote Cheap by contract: PATH, known locations, the registry, the application's files; never a launch, never the network. */
export interface Detector {
  id: string;
  detect(): boolean;
}

export type PresentedItem = UiItem & { unavailable?: true; action?: "install" };

const STATE_ORDER = ["installed", "detected", "available"] as const;

function byId(left: UiItem, right: UiItem): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** @implNote The strongest state wins, so an id found in two inputs is one row. */
export function threeStateList(installed: UiItem[], detected: UiItem[], available: UiItem[]): UiItem[] {
  const seen = new Set<string>();
  const rows: UiItem[] = [];
  [installed, detected, available].forEach((group, index) => {
    const fresh = group.filter((entry) => !seen.has(entry.id)).sort(byId);
    for (const entry of fresh) seen.add(entry.id);
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

export function pluginList(running: RunningHost, detectors: Detector[]): UiItem[] {
  const installed = installedIds(running);
  const detected = detectors.filter((detector) => detector.detect()).map(({ id }) => id);
  const available = running.bundles.list().map(({ id }) => id);
  return threeStateList(asItems(installed), asItems(detected), asItems(available));
}

export function presentItems(items: UiItem[]): PresentedItem[] {
  return items.map((entry) => (entry.state === "detected" || entry.state === "available" ? { ...entry, unavailable: true, action: "install" } : entry));
}

/** @implNote A host screen, so its `plugin` is the fixed word "host": no plugin owns it, and a plugin view cannot bind a host list (rule V3). */
export async function renderPluginList(running: RunningHost, detectors: Detector[]): Promise<HeadlessScreen> {
  const items = presentItems(pluginList(running, detectors));
  return {
    plugin: "host",
    kind: "host",
    title: "Plugins",
    nodes: [{ id: "plugins", component: "table", state: "ready", data: { items }, props: {} }],
  };
}
