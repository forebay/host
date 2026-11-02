import type { PluginManifest } from "@weivel/typescript";
import { SETTINGS_TITLE, SETTINGS_VIEW_ID } from "./settings-view.js";

export interface NavigationEntry {
  plugin: string;
  kind: "view" | "settings" | "action";
  id: string;
  title: string;
  pinned: boolean;
}

export interface Navigation {
  entries: NavigationEntry[];
  /** Everything under the `ui` settings except `plugins`, for a renderer to apply as it sees fit. */
  preferences: Record<string, unknown>;
}

interface PluginCustomisation {
  hidden: boolean;
  order: number;
  pinned: string[];
  defaultView?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringsIn(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** @implNote A value of the wrong type is ignored like an unknown key, so one bad edit to settings.json never hides a plugin. */
function customisationOf(ui: Record<string, unknown>, pluginId: string): PluginCustomisation {
  const plugins = isRecord(ui.plugins) ? ui.plugins : {};
  const own = isRecord(plugins[pluginId]) ? plugins[pluginId] : {};
  return {
    hidden: own.hidden === true,
    order: Number.isInteger(own.order) ? (own.order as number) : Number.POSITIVE_INFINITY,
    pinned: stringsIn(own.pinned),
    defaultView: typeof own.defaultView === "string" ? own.defaultView : undefined,
  };
}

function byOrderThenId(left: [PluginManifest, PluginCustomisation], right: [PluginManifest, PluginCustomisation]): number {
  if (left[1].order !== right[1].order) return left[1].order < right[1].order ? -1 : 1;
  return left[0].id < right[0].id ? -1 : left[0].id > right[0].id ? 1 : 0;
}

function viewOrder(viewIds: readonly string[], customisation: PluginCustomisation): string[] {
  const declared = new Set(viewIds);
  const leading = [customisation.defaultView, ...customisation.pinned].filter((id): id is string => id !== undefined && declared.has(id));
  return [...new Set([...leading, ...[...viewIds].sort()])];
}

function viewEntries(manifest: PluginManifest, customisation: PluginCustomisation): NavigationEntry[] {
  const views = manifest.views ?? {};
  const pinned = new Set(customisation.pinned);
  return viewOrder(Object.keys(views), customisation).map((id) => ({
    plugin: manifest.id,
    kind: "view" as const,
    id,
    title: views[id].title,
    pinned: pinned.has(id),
  }));
}

function settingsEntries(manifest: PluginManifest): NavigationEntry[] {
  if (Object.keys(manifest.settings ?? {}).length === 0) return [];
  return [{ plugin: manifest.id, kind: "settings", id: SETTINGS_VIEW_ID, title: SETTINGS_TITLE, pinned: false }];
}

function actionEntries(manifest: PluginManifest): NavigationEntry[] {
  const actions = manifest.actions ?? {};
  return Object.keys(actions)
    .sort()
    .map((id) => ({ plugin: manifest.id, kind: "action" as const, id, title: actions[id].label, pinned: false }));
}

function entriesOf(manifest: PluginManifest, customisation: PluginCustomisation): NavigationEntry[] {
  return [...viewEntries(manifest, customisation), ...settingsEntries(manifest), ...actionEntries(manifest)];
}

function preferencesOf(ui: Record<string, unknown>): Record<string, unknown> {
  const { plugins: _plugins, ...preferences } = ui;
  return preferences;
}

/**
 * Merges what every plugin declares with the user's customisation under the `ui` settings into one
 * navigation, so every host lists the same entries in the same order.
 *
 * @implNote Plugins without an `order` sort after every ordered one. An id under `ui.plugins` that
 * names no plugin, and a pinned or default view the plugin does not declare, are ignored silently,
 * because settings follow the user to hosts that do not run every plugin.
 */
export function mergeNavigation(plugins: PluginManifest[], ui: Record<string, unknown>): Navigation {
  const customised = plugins
    .map((manifest): [PluginManifest, PluginCustomisation] => [manifest, customisationOf(ui, manifest.id)])
    .filter(([, customisation]) => !customisation.hidden)
    .sort(byOrderThenId);
  return {
    entries: customised.flatMap(([manifest, customisation]) => entriesOf(manifest, customisation)),
    preferences: preferencesOf(ui),
  };
}
