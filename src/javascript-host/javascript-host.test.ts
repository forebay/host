import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installedWorld, runNode } from "../__fixtures__/javascript-host-world.js";
import type { JavascriptHostWorld } from "../__fixtures__/javascript-host-world.js";
import { userPathEntriesUnder } from "../__fixtures__/user-path.js";

const SESSION_HOST = "forebay-host";

let world: JavascriptHostWorld;

function sessionDriver(): string {
  const driver = join(world.base, "driver.mjs");
  writeFileSync(
    driver,
    [
      `const host = await import(${JSON.stringify(pathToFileURL(world.hostEntry).href)});`,
      `const session = await host.runSessionHost(${JSON.stringify(SESSION_HOST)});`,
      'const screen = await session.render({ plugin: "viewer", kind: "view", id: "overview" });',
      "await session.stop();",
      "process.stdout.write(JSON.stringify(screen));",
    ].join("\n"),
  );
  return driver;
}

function runRecords(): string[] {
  const directory = join(world.state, "bundles", "runs", SESSION_HOST);
  return existsSync(directory) ? readdirSync(directory) : [];
}

beforeAll(async () => {
  world = await installedWorld();
}, 300000);

afterAll(() => {
  expect(userPathEntriesUnder(world.base)).toEqual([]);
  rmSync(world.base, { recursive: true, force: true });
});

describe("the javascript-host bundle", () => {
  it("is installed by the native install beside the registration it starts", () => {
    expect(existsSync(world.hostEntry)).toBe(true);
    expect(existsSync(join(world.cache, "hosts", "javascript-host.json"))).toBe(true);
  });

  it("starts the registered host's plugin in process and answers a ui.plan round through its binding", () => {
    const run = runNode(world, [sessionDriver()]);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    const screen = JSON.parse(run.stdout) as { plugin: string; title: string; nodes: Array<{ id: string; state: string; data?: unknown }> };
    expect(screen).toMatchObject({ plugin: "viewer", title: "Overview" });
    expect(screen.nodes.find((node) => node.id === "rows")).toMatchObject({ state: "ready", data: { items: [{ id: "x", state: "detected", unavailable: true, install: true }] } });
    expect(screen.nodes.find((node) => node.id === "greeting")).toMatchObject({ state: "ready", data: { text: "hello" } });
    expect(runRecords()).toEqual([]);
  });

  it("publishes an empty environment as its ready record when no plugin provides a front door", () => {
    const record = JSON.parse(readFileSync(join(world.state, "processes", `${SESSION_HOST}.ready.json`), "utf8")) as Record<string, unknown>;
    expect(record.environment).toEqual({});
    expect(record.refused).toBeUndefined();
  });

  it("records what it runs as the host's references", () => {
    const references = JSON.parse(readFileSync(join(world.state, "bundles", `${SESSION_HOST}.json`), "utf8")) as { run: Record<string, string> };
    expect(references.run).toMatchObject({ viewer: "1.0.0" });
  });

  it("stops and exits once processes.prune answers exit, as a background host no one holds", () => {
    const started = Date.now();
    const run = runNode(world, [world.hostEntry, SESSION_HOST]);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(Date.now() - started).toBeLessThan(60000);
    expect(runRecords()).toEqual([]);
  });

  it("refuses an unregistered host with the fix and a failing exit code", () => {
    const run = runNode(world, [world.hostEntry, "nobody"]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("nobody");
    expect(run.stderr).toContain("fix: ");
  });
});
