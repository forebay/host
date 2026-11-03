import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFixture } from "./__fixtures__/context.js";
import type { Catalog } from "./catalog/catalog.js";
import { startFixtureHost } from "./__fixtures__/running-host.js";
import type { FixtureHost } from "./__fixtures__/running-host.js";
import { applicationList, pluginList, presentItems, renderPluginList, threeStateList } from "./lists.js";

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

  it("keeps the first of an id repeated within one input", () => {
    const list = threeStateList([{ id: "a", label: "first" }, { id: "a", label: "second" }], [], []);
    expect(list).toEqual([{ id: "a", label: "first", state: "installed" }]);
  });

  it("orders by state then by id", () => {
    const list = threeStateList([item("z"), item("b")], [item("y"), item("c")], [item("x"), item("a")]);
    expect(list.map(({ id, state }) => `${state}:${id}`)).toEqual(["installed:b", "installed:z", "detected:c", "detected:y", "available:a", "available:x"]);
  });
});

describe("presentItems", () => {
  it("marks detected and available items unavailable and installable, and leaves installed ones alone", () => {
    const presented = presentItems([{ id: "i", state: "installed" }, { id: "d", state: "detected" }, { id: "a", state: "available" }, item("n")]);
    expect(presented).toEqual([
      { id: "i", state: "installed" },
      { id: "d", state: "detected", unavailable: true, install: true },
      { id: "a", state: "available", unavailable: true, install: true },
      { id: "n" },
    ]);
  });

  it("drops an action a detected row carried, since an unusable row offers only install", () => {
    expect(presentItems([{ id: "d", state: "detected", values: {}, ...{ action: "open" } } as never])).toEqual([
      { id: "d", state: "detected", values: {}, install: true, unavailable: true },
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

describe("pluginList detection", () => {
  it("counts a detector that throws as not detected and still lists the rest", async () => {
    fixture = await startFixtureHost(["viewer"]);
    const throwing = {
      id: "greeter",
      detect: () => {
        throw new Error("the registry could not be read");
      },
    };
    const list = pluginList(fixture.running, [throwing, { id: "rival", detect: () => true }]);
    const states = Object.fromEntries(list.map(({ id, state }) => [id, state]));
    expect(states.greeter).toBe("available");
    expect(states.rival).toBe("detected");
  });
});

describe("renderPluginList", () => {
  async function plugins(detected: boolean) {
    fixture = await startFixtureHost(["viewer"]);
    expect(fixture.running.bundles.list().map(({ id }) => id)).toContain("greeter");
    expect(fixture.running.status().active).not.toContain("greeter");
    const screen = await renderPluginList(fixture.running, [{ id: "greeter", detect: () => detected }]);
    return { screen, items: (screen.nodes[0].data as { items: Array<Record<string, unknown>> }).items };
  }

  it("shows a bundled, not enabled plugin that a detector finds as a detected, installable row", async () => {
    const { screen, items } = await plugins(true);
    expect(screen.kind).toBe("host");
    expect(screen).not.toHaveProperty("plugin");
    expect(screen.nodes).toHaveLength(1);
    expect(screen.nodes[0]).toMatchObject({ component: "table", state: "ready" });
    expect(items.find((row) => row.id === "greeter")).toMatchObject({ state: "detected", unavailable: true, install: true });
    expect(items.find((row) => row.id === "viewer")).not.toHaveProperty("unavailable");
  });

  it("shows the same plugin as available when no detector finds it", async () => {
    const { items } = await plugins(false);
    expect(items.find((row) => row.id === "greeter")).toMatchObject({ state: "available", unavailable: true, install: true });
  });
});

describe("applicationList", () => {
  const applicationOf = (id: string, binary: string) => ({ id, label: `${id} label`, binary, home: { candidates: ["~/.x"] }, packages: {} });
  const catalog = {
    format: 1,
    items: {
      "claude-host": { kind: "host", versions: {}, latest: "1.0.0", application: applicationOf("claude", "claude") },
      "opencode-host": { kind: "host", versions: {}, latest: "1.0.0", application: applicationOf("opencode", "opencode") },
      "gemini-host": { kind: "host", versions: {}, latest: "1.0.0", application: applicationOf("gemini", "gemini") },
      "some-plugin": { kind: "plugin", versions: {}, latest: "1.0.0" },
    },
  } as unknown as Catalog;
  const provenance = { method: "test", version: "1.0.0", location: join(tmpdir(), "x"), os: "linux", architecture: "x64", installedAt: "2026-01-01T00:00:00Z" };

  it("lists installed from the registry, detected from PATH or a method, and the rest as available", () => {
    const context = createFixture();
    try {
      context.runtime.registry.register({
        places: context.places,
        registration: { id: "claude-host", kind: "host", version: "1.0.0", application: applicationOf("claude", "claude"), provenance, requiresCommand: false },
      });
      const binDirectory = join(context.base, "bin");
      mkdirSync(binDirectory);
      writeFileSync(join(binDirectory, "opencode.cmd"), "");
      chmodSync(join(binDirectory, "opencode.cmd"), 0o755);
      const environment = { PATH: binDirectory, PATHEXT: ".CMD" };
      const rows = applicationList(context.runtime, catalog, context.places, environment, [], "win32");
      expect(rows).toEqual([
        { id: "claude", label: "claude label", state: "installed" },
        { id: "opencode", label: "opencode label", state: "detected" },
        { id: "gemini", label: "gemini label", state: "available" },
      ]);
    } finally {
      context.dispose();
    }
  });

  it("lists an application detected when a method reports its package installed", () => {
    const context = createFixture();
    try {
      const providers = [{ method: "npm", item: "gemini", package: "@x/gemini", answer: { installed: true } }];
      const rows = applicationList(context.runtime, catalog, context.places, { PATH: "" }, providers, "linux");
      expect(rows.find(({ id }) => id === "gemini")?.state).toBe("detected");
    } finally {
      context.dispose();
    }
  });
});
