import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runNode } from "../__fixtures__/javascript-host-world.js";
import { holdLiveRun, installedProxyWorld, publishProviderA, readyRecord, SESSION_HOST, setHostSetting } from "../__fixtures__/proxy-world.js";
import type { ProxyWorld } from "../__fixtures__/proxy-world.js";
import { userPathEntriesUnder } from "../__fixtures__/user-path.js";

/** Long enough for an update check of a local catalog to fetch a newer version, were one started. */
const LONG_ACTION_MILLISECONDS = 5000;
/** Lets every check consult its catalog source again at once instead of waiting out the day. */
const RECHECK_AT_ONCE_HOURS = 1e-9;

let world: ProxyWorld;

/** Every file under `directory` with its size, the cache as a check that fetched anything would change it. */
function treeOf(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return `${path.slice(directory.length)} ${statSync(path).size}`;
    })
    .sort();
}

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

  it("runs what the host's last start recorded while a session runs, leaving its references as they were", () => {
    const references = join(world.state, "bundles", `${SESSION_HOST}.json`);
    const compact = JSON.stringify(JSON.parse(readFileSync(references, "utf8")));
    writeFileSync(references, compact);
    const release = holdLiveRun(world);
    try {
      const run = action("provider-a", "login", JSON.stringify({ label: "another" }));
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      expect(JSON.parse(run.stdout)).toEqual({ outcome: "added", accounts: ["someone", "another"] });
      expect(readFileSync(references, "utf8")).toBe(compact);
    } finally {
      release();
    }
  });

  it("starts no update check, leaving the cache and the boot hint as they were though a newer version is listed", async () => {
    await publishProviderA(world, "1.0.1");
    setHostSetting(world, "updates.intervalHours", RECHECK_AT_ONCE_HOURS);
    const cache = world.environment.SPISOR_CACHE as string;
    const hint = join(cache, "hosts", "javascript-host.json");
    const references = join(world.state, "bundles", `${SESSION_HOST}.json`);
    const release = holdLiveRun(world);
    try {
      const before = { tree: treeOf(cache), hint: readFileSync(hint, "utf8"), references: readFileSync(references, "utf8") };
      const run = action("provider-a", "wait", JSON.stringify({ milliseconds: LONG_ACTION_MILLISECONDS }));
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      expect({ tree: treeOf(cache), hint: readFileSync(hint, "utf8"), references: readFileSync(references, "utf8") }).toEqual(before);
    } finally {
      release();
    }
  }, 120000);

  it("serves no proxy and publishes no ready record", () => {
    expect(readyRecord(world)).toBeUndefined();
  });

  it("refuses an action the plugin does not declare with the fix and exit code 1", () => {
    const run = action("provider-a", "nothing", "{}");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("declares no action nothing");
    expect(run.stderr).toContain("fix: ");
  });

  it("refuses to run when the host's references cannot be read, rather than applying a start beside it", () => {
    const references = join(world.state, "bundles", `${SESSION_HOST}.json`);
    const original = readFileSync(references, "utf8");
    writeFileSync(references, "{\"run\": ");
    try {
      const run = action("provider-a", "login", JSON.stringify({ label: "third" }));
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("could not be read");
      expect(readFileSync(references, "utf8")).toBe("{\"run\": ");
    } finally {
      writeFileSync(references, original);
    }
  });

  it("applies the settings while nothing of the host runs, so a plugin enabled since the last start runs its action", () => {
    setHostSetting(world, "plugins.provider-b.enabled", false);
    expect(action("provider-a", "wait", JSON.stringify({ milliseconds: 0 })).status).toBe(0);
    const references = join(world.state, "bundles", `${SESSION_HOST}.json`);
    expect(readFileSync(references, "utf8")).not.toContain("provider-b");
    setHostSetting(world, "plugins.provider-b.enabled", true);
    const run = action("provider-b", "login", JSON.stringify({ label: "enabled-since" }));
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ outcome: "added", accounts: expect.arrayContaining(["enabled-since"]) });
  });

  it("refuses input that is not a JSON object as misuse", () => {
    const run = action("provider-a", "login", "[1]");
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("fix: ");
  });
});
