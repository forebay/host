import { afterEach, describe, expect, it } from "vitest";
import { HandClock, startFixtureHost } from "../__fixtures__/running-host.js";
import type { FixtureHost } from "../__fixtures__/running-host.js";
import { renderEntry, renderHeadless, renderHeadlessSettings } from "./headless.js";
import { mergeNavigation } from "./navigation.js";
import type { HeadlessNode, HeadlessScreen } from "./headless.js";

let fixture: FixtureHost | undefined;

async function render(viewId: string, plugin = "viewer", enabled = [plugin]): Promise<HeadlessScreen> {
  fixture = await startFixtureHost(enabled);
  return renderHeadless(fixture.running, plugin, viewId);
}

function node(screen: HeadlessScreen, id: string): HeadlessNode {
  const found = screen.nodes.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no node ${id}`);
  return found;
}

afterEach(async () => {
  await fixture?.dispose();
  fixture = undefined;
});

describe("renderHeadless", () => {
  it("renders a bound table ready with what its binding answered", async () => {
    const screen = await render("overview");
    expect(screen).toMatchObject({ plugin: "viewer", view: "overview", title: "Overview" });
    expect(node(screen, "rows")).toMatchObject({ component: "table", parent: "main", state: "ready", data: { items: [{ id: "x", state: "detected" }] } });
    expect(node(screen, "main")).toMatchObject({ component: "stack", state: "ready" });
    expect(node(screen, "main")).not.toHaveProperty("parent");
  });

  it("puts only the node whose answer has the wrong shape in error, with the path at fault", async () => {
    const screen = await render("wrongShape");
    expect(node(screen, "rows").state).toBe("error");
    expect(node(screen, "rows").error?.path).toBe("items");
    expect(node(screen, "rows")).not.toHaveProperty("data");
    expect(node(screen, "greeting")).toMatchObject({ state: "ready", data: { text: "hello" } });
  });

  it("puts a node answering a bare string in error", async () => {
    expect(node(await render("bare"), "rows").state).toBe("error");
  });

  it("puts a node whose binding throws in error, renders its sibling, and quarantines nothing", async () => {
    const screen = await render("failing");
    expect(node(screen, "broken").state).toBe("error");
    expect(node(screen, "broken").error?.detail).toContain("the status file is unreadable");
    expect(node(screen, "greeting").state).toBe("ready");
    expect(fixture?.running.status().quarantined).toEqual([]);
    expect(fixture?.running.status().active).toEqual(["viewer"]);
  });

  it("puts a node whose binding never answers in error once the deadline passes", async () => {
    const clock = new HandClock();
    fixture = await startFixtureHost(["viewer"], clock);
    const pending = renderHeadless(fixture.running, "viewer", "hanging");
    await clock.fireOnceScheduled();
    expect(node(await pending, "slow").state).toBe("error");
  });

  it("reads the branch the node's chart names, never the one the answer happens to carry", async () => {
    const screen = await render("charts");
    expect(node(screen, "trend")).toMatchObject({ state: "ready", data: { series: [{ label: "load", points: [1, 2, 3] }] } });
    expect(node(screen, "trend").data).not.toHaveProperty("value");
    expect(node(screen, "usage")).toMatchObject({ state: "ready", data: { value: 3, maximum: 10 } });
    expect(node(screen, "usage").data).not.toHaveProperty("series");
    expect(node(screen, "gauge").state).toBe("error");
  });

  it("carries only the known node members in props, so an unknown one such as color never reaches a renderer", async () => {
    const rows = node(await render("overview"), "rows");
    expect(rows.props).toEqual({ tone: "accent", span: 6, action: "restart" });
    expect(rows.props).not.toHaveProperty("color");
  });

  it("renders a bound node unavailable when its plugin is not running, and its unbound sibling ready", async () => {
    const screen = await render("status", "dormant");
    expect(fixture?.running.status().quarantined.map((entry) => entry.id)).toEqual(["dormant"]);
    expect(node(screen, "summary").state).toBe("unavailable");
    expect(node(screen, "heading")).toMatchObject({ state: "ready", props: { text: "Dormant" } });
  });

  it("renders the generated settings screen through the same path as a view", async () => {
    fixture = await startFixtureHost(["viewer"]);
    const screen = await renderHeadlessSettings(fixture.running, "viewer");
    expect(screen).toMatchObject({ plugin: "viewer", kind: "settings", title: "Settings" });
    expect(screen).not.toHaveProperty("view");
    expect(screen.nodes.filter((entry) => entry.component === "field").map((entry) => entry.props.field)).toEqual(["depth", "theme"]);
    expect(screen.nodes.every((entry) => entry.state === "ready")).toBe(true);
  });

  it("renders a declared view named settings as itself, and keeps the generated settings screen reachable", async () => {
    const declared = await render("settings");
    expect(declared).toMatchObject({ kind: "view", view: "settings", title: "Declared settings" });
    const running = fixture!.running;
    const entries = mergeNavigation([running.loaded.deployed.find((entry) => entry.manifest.id === "viewer")!.manifest], {}).entries;
    const viewEntry = entries.find((entry) => entry.kind === "view" && entry.id === "settings")!;
    const settingsEntry = entries.find((entry) => entry.kind === "settings")!;
    expect((await renderEntry(running, viewEntry)).title).toBe("Declared settings");
    const generated = await renderEntry(running, settingsEntry);
    expect(generated).toMatchObject({ kind: "settings", title: "Settings" });
    expect(generated.nodes[0].component).toBe("form");
  });

  it("refuses to render an action entry as a screen", async () => {
    fixture = await startFixtureHost(["viewer"]);
    await expect(renderEntry(fixture.running, { plugin: "viewer", kind: "action", id: "restart", title: "Restart", pinned: false })).rejects.toThrow("restart");
  });

  it("puts a node in error, not ready with another plugin's answer, when two active plugins provide its service", async () => {
    const screen = await render("hello", "silent", ["greeter", "silent"]);
    expect(node(screen, "message").state).toBe("error");
    expect(node(screen, "message")).not.toHaveProperty("data");
  });

  it("renders a quarantined plugin's node unavailable while another plugin provides the same service", async () => {
    const screen = await render("hello", "rival", ["greeter", "rival"]);
    expect(fixture?.running.status().quarantined.map((entry) => entry.id)).toEqual(["rival"]);
    expect(node(screen, "message").state).toBe("unavailable");
    expect(node(screen, "message")).not.toHaveProperty("data");
  });

  it("refuses a view the plugin does not declare", async () => {
    await expect(render("nowhere")).rejects.toThrow("nowhere");
  });
});

describe("renderHeadless item presentation", () => {
  it("gives a plugin's own detected row the unavailable treatment", async () => {
    const screen = await render("overview");
    expect(node(screen, "rows").data).toEqual({ items: [{ id: "x", state: "detected", unavailable: true, action: "install" }] });
  });
});
