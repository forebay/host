import { afterEach, describe, expect, it } from "vitest";
import { startFixtureHost } from "./__fixtures__/running-host.js";
import type { FixtureHost } from "./__fixtures__/running-host.js";
import { pluginList, presentItems, renderPluginList, threeStateList } from "./lists.js";

let fixture: FixtureHost | undefined;

afterEach(async () => {
  await fixture?.dispose();
  fixture = undefined;
});

const item = (id: string) => ({ id });

describe("threeStateList", () => {
  it("lists an id found in all three inputs once, as installed", () => {
    const list = threeStateList([item("a")], [item("a")], [item("a")]);
    expect(list).toEqual([{ id: "a", state: "installed" }]);
  });

  it("lists an id found as detected and available as detected", () => {
    expect(threeStateList([], [item("a")], [item("a")])).toEqual([{ id: "a", state: "detected" }]);
  });

  it("orders by state then by id", () => {
    const list = threeStateList([item("z"), item("b")], [item("y"), item("c")], [item("x"), item("a")]);
    expect(list.map(({ id, state }) => `${state}:${id}`)).toEqual(["installed:b", "installed:z", "detected:c", "detected:y", "available:a", "available:x"]);
  });
});

describe("presentItems", () => {
  it("marks detected and available items unavailable with an install action, and leaves installed ones alone", () => {
    const presented = presentItems([{ id: "i", state: "installed" }, { id: "d", state: "detected" }, { id: "a", state: "available" }, item("n")]);
    expect(presented).toEqual([
      { id: "i", state: "installed" },
      { id: "d", state: "detected", unavailable: true, action: "install" },
      { id: "a", state: "available", unavailable: true, action: "install" },
      { id: "n" },
    ]);
  });
});

describe("pluginList", () => {
  it("answers an enabled plugin installed, a detected one detected and the rest available", async () => {
    fixture = await startFixtureHost(["viewer"]);
    const list = pluginList(fixture.running, [{ id: "greeter", detect: () => true }, { id: "rival", detect: () => false }]);
    const states = Object.fromEntries(list.map(({ id, state }) => [id, state]));
    expect(states.viewer).toBe("installed");
    expect(states.greeter).toBe("detected");
    expect(states.rival).toBe("available");
  });
});

describe("renderPluginList", () => {
  it("shows a present, not enabled plugin that a detector finds as a detected row with an install action", async () => {
    fixture = await startFixtureHost(["viewer"]);
    const screen = await renderPluginList(fixture.running, [{ id: "greeter", detect: () => true }]);
    expect(screen.kind).toBe("host");
    expect(screen.nodes).toHaveLength(1);
    const [table] = screen.nodes;
    expect(table).toMatchObject({ component: "table", state: "ready" });
    const items = (table.data as { items: Array<Record<string, unknown>> }).items;
    expect(items.find((row) => row.id === "greeter")).toMatchObject({ state: "detected", unavailable: true, action: "install" });
    expect(items.find((row) => row.id === "viewer")).not.toHaveProperty("unavailable");
  });
});
