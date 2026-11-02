import type { PluginManifest } from "@weivel/typescript";
import { describe, expect, it } from "vitest";
import { mergeNavigation } from "./navigation.js";
import type { NavigationEntry } from "./navigation.js";

const VIEW = { title: "", nodes: [{ id: "root", component: "stack" as const }] };

function plugin(id: string, extra: Partial<PluginManifest> = {}): PluginManifest {
  return { id, api: 1, ...extra };
}

const TOOLS = plugin("tools", {
  views: { beta: { ...VIEW, title: "Beta" }, alpha: { ...VIEW, title: "Alpha" }, gamma: { ...VIEW, title: "Gamma" }, delta: { ...VIEW, title: "Delta" } },
  settings: { depth: { type: "number", label: "Depth" } },
  actions: {
    sync: { label: "Sync", call: { service: "tools:main", method: "sync" } },
    clear: { label: "Clear", call: { service: "tools:main", method: "clear" } },
  },
});

const NOTES = plugin("notes", { views: { list: { ...VIEW, title: "List" } } });
const ARCHIVE = plugin("archive", { views: { old: { ...VIEW, title: "Old" } } });

function keysOf(entries: NavigationEntry[]): string[] {
  return entries.map(({ plugin: owner, kind, id }) => `${owner}/${kind}/${id}`);
}

describe("mergeNavigation", () => {
  it("orders plugins by their order, then by id, with unordered plugins last", () => {
    const navigation = mergeNavigation([TOOLS, NOTES, ARCHIVE], { plugins: { notes: { order: 1 }, tools: { order: 2 } } });
    expect([...new Set(navigation.entries.map((entry) => entry.plugin))]).toEqual(["notes", "tools", "archive"]);
  });

  it("orders plugins sharing an order by id", () => {
    const navigation = mergeNavigation([TOOLS, NOTES, ARCHIVE], {});
    expect([...new Set(navigation.entries.map((entry) => entry.plugin))]).toEqual(["archive", "notes", "tools"]);
  });

  it("puts the default view first, then pinned views, then views by key, then settings, then actions by key", () => {
    const navigation = mergeNavigation([TOOLS], { plugins: { tools: { defaultView: "gamma", pinned: ["delta", "beta"] } } });
    expect(keysOf(navigation.entries)).toEqual([
      "tools/view/gamma",
      "tools/view/delta",
      "tools/view/beta",
      "tools/view/alpha",
      "tools/settings/settings",
      "tools/action/clear",
      "tools/action/sync",
    ]);
  });

  it("marks pinned views pinned and titles every entry", () => {
    const navigation = mergeNavigation([TOOLS], { plugins: { tools: { pinned: ["delta"] } } });
    expect(navigation.entries.find((entry) => entry.id === "delta")).toEqual({ plugin: "tools", kind: "view", id: "delta", title: "Delta", pinned: true });
    expect(navigation.entries.find((entry) => entry.id === "alpha")?.pinned).toBe(false);
    expect(navigation.entries.find((entry) => entry.kind === "settings")?.title).toBe("Settings");
    expect(navigation.entries.find((entry) => entry.id === "sync")?.title).toBe("Sync");
  });

  it("leaves a hidden plugin out entirely", () => {
    const navigation = mergeNavigation([TOOLS, NOTES], { plugins: { tools: { hidden: true } } });
    expect(keysOf(navigation.entries)).toEqual(["notes/view/list"]);
  });

  it("ignores a plugin id it does not know and a pinned or default view that does not exist", () => {
    const navigation = mergeNavigation([NOTES], { plugins: { gone: { order: 0, hidden: true }, notes: { pinned: ["missing"], defaultView: "absent" } } });
    expect(keysOf(navigation.entries)).toEqual(["notes/view/list"]);
    expect(navigation.entries[0].pinned).toBe(false);
  });

  it("adds no settings entry for a plugin declaring no settings", () => {
    expect(mergeNavigation([NOTES], {}).entries.some((entry) => entry.kind === "settings")).toBe(false);
  });

  it("passes everything under ui but plugins through as preferences", () => {
    const navigation = mergeNavigation([NOTES], { theme: "dark", density: "compact", plugins: { notes: { order: 1 } } });
    expect(navigation.preferences).toEqual({ theme: "dark", density: "compact" });
  });

  it("ignores customisation values of the wrong type", () => {
    const navigation = mergeNavigation([TOOLS, NOTES], { plugins: { tools: { hidden: "yes", pinned: "delta", defaultView: 3, order: "first" }, notes: { order: 1.5 } } });
    expect(keysOf(navigation.entries).slice(0, 2)).toEqual(["notes/view/list", "tools/view/alpha"]);
    expect(navigation.entries.some((entry) => entry.pinned)).toBe(false);
  });
});
