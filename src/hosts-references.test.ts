import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFixture } from "./__fixtures__/context.js";
import type { Fixture } from "./__fixtures__/context.js";
import { hostsApi } from "./hosts.js";
import { registerHost } from "./registration.js";
import { recordReferences } from "./updates/references.js";

let fixture: Fixture;

beforeEach(() => {
  fixture = createFixture();
});

afterEach(() => fixture.dispose());

describe("hosts.remove", () => {
  it("deletes the host's reference file along with its registration, and leaves another host's", () => {
    const provenance = { method: "catalog", version: "1.0.0", location: fixture.base, os: "linux", architecture: "x64", installedAt: "2026-01-01T00:00:00Z" };
    registerHost(fixture.runtime, fixture.places, fixture.host, provenance, {});
    recordReferences(fixture.places.state, fixture.host.id, { run: { a: "1.0.0" }, next: {} });
    recordReferences(fixture.places.state, "other-host", { run: {}, next: {} });

    const removal = hostsApi(fixture.runtime, fixture.places, {}).remove(fixture.host.id);

    expect(removal.forgotten).toBe(true);
    expect(existsSync(join(fixture.places.state, "bundles", `${fixture.host.id}.json`))).toBe(false);
    expect(existsSync(join(fixture.places.state, "bundles", "other-host.json"))).toBe(true);
  });
});
