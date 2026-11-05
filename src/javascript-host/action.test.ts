import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runNode } from "../__fixtures__/javascript-host-world.js";
import { installedProxyWorld, readyRecord, SESSION_HOST } from "../__fixtures__/proxy-world.js";
import type { ProxyWorld } from "../__fixtures__/proxy-world.js";
import { userPathEntriesUnder } from "../__fixtures__/user-path.js";

let world: ProxyWorld;

function action(...arguments_: string[]) {
  return runNode(world, [world.hostEntry, SESSION_HOST, "action", ...arguments_]);
}

beforeAll(async () => {
  world = await installedProxyWorld();
}, 300000);

afterAll(() => {
  expect(userPathEntriesUnder(world.base)).toEqual([]);
  rmSync(world.base, { recursive: true, force: true });
});

describe("the javascript-host's action mode", () => {
  it("runs a plugin's action with the input over its declared argument and prints the answer as JSON", () => {
    const run = action("provider-a", "login", JSON.stringify({ label: "someone" }));
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ outcome: "added", accounts: ["someone"] });
  });

  it("serves no proxy and publishes no ready record", () => {
    expect(readyRecord(world)).toBeUndefined();
  });

  it("refuses an action the plugin does not declare with the fix and exit code 1", () => {
    const run = action("provider-a", "nothing", "{}");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("declares no action nothing");
    expect(run.stderr).toContain("fix: ");
  });

  it("refuses input that is not a JSON object as misuse", () => {
    const run = action("provider-a", "login", "[1]");
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("fix: ");
  });
});
