import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFixture } from "./__fixtures__/context.js";
import { userPathEntriesUnder } from "./__fixtures__/user-path.js";
import type { Fixture } from "./__fixtures__/context.js";
import { hostsApi } from "./hosts.js";
import { registerHost } from "./registration.js";
import type { Provenance } from "./registration.js";
import type { Runtime } from "./runtime/open.js";

let fixture: Fixture;
let environment: Record<string, string>;

beforeEach(() => {
  fixture = createFixture();
  const userHome = join(fixture.base, "user");
  mkdirSync(userHome, { recursive: true });
  mkdirSync(join(fixture.base, "path"), { recursive: true });
  environment = { PATH: join(fixture.base, "path"), HOME: userHome, USERPROFILE: userHome, SHELL: "/bin/sh" };
});

afterEach(() => {
  try {
    fixture.runtime.changes.reverse({ places: fixture.places, host: fixture.host.id });
    expect(userPathEntriesUnder(fixture.base)).toEqual([]);
  } finally {
    fixture.dispose();
  }
});

function provenanceAt(location: string): Provenance {
  return { method: "npm", version: "1.0.0", location, os: "linux", architecture: "x64", installedAt: "2026-01-01T00:00:00Z" };
}

function registerExisting(): void {
  const location = join(fixture.base, "install.txt");
  writeFileSync(location, "x");
  registerHost(fixture.runtime, fixture.places, fixture.host, provenanceAt(location), environment);
}

function listedIds(runtime: Runtime = fixture.runtime): string[] {
  return hostsApi(runtime, fixture.places, environment).list().map((entry) => String(entry.registration.id));
}

describe("hostsApi", () => {
  it("removes a host by reversing its changes and then forgetting it", () => {
    registerExisting();
    const changed = join(fixture.base, "changed.txt");
    fixture.runtime.changes.apply({ places: fixture.places, host: fixture.host.id, change: { kind: "file", path: changed, content: "hi" } });
    expect(existsSync(changed)).toBe(true);
    const removed = hostsApi(fixture.runtime, fixture.places, environment).remove(fixture.host.id);
    expect(removed).toMatchObject({ reversed: 1, drifted: [], forgotten: true });
    expect(existsSync(changed)).toBe(false);
    expect(listedIds()).toEqual([]);
  });

  it("leaves the registration in place when the reverse throws", () => {
    registerExisting();
    const failing: Runtime = {
      ...fixture.runtime,
      changes: { ...fixture.runtime.changes, reverse: () => { throw new Error("stuck"); } },
    };
    expect(() => hostsApi(failing, fixture.places, environment).remove(fixture.host.id)).toThrow("stuck");
    expect(listedIds()).toEqual([fixture.host.id]);
  });

  it("answers as orphans the hosts whose install location is gone", () => {
    registerExisting();
    const orphanIdentity = { ...fixture.host, id: "orphan-host" };
    registerHost(fixture.runtime, fixture.places, orphanIdentity, provenanceAt(join(fixture.base, "missing")), environment);
    const api = hostsApi(fixture.runtime, fixture.places, environment);
    expect(api.list()).toHaveLength(2);
    expect(api.orphans().map((entry) => entry.registration.id)).toEqual(["orphan-host"]);
  });

  it("adds, renames and deletes a command", () => {
    registerExisting();
    const api = hostsApi(fixture.runtime, fixture.places, environment);
    const target = join(fixture.base, "bin", "tool");
    const added = api.addCommand(fixture.host.id, environment.HOME, "tool", target);
    expect(added).toBe("tool");
    expect(api.renameCommand(fixture.host.id, "tool", "tool-renamed")).toBe("tool-renamed");
    api.deleteCommand(fixture.host.id, "tool-renamed");
    const commands = fixture.runtime.registry.get({ places: fixture.places, id: fixture.host.id }).registration?.commands as Array<{ name: string; state: string }>;
    expect(commands.find((command) => command.name === "tool-renamed")?.state).toBe("deleted");
  });
});
