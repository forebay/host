import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFixture } from "./context/fixture.js";
import { userPathEntriesUnder } from "./context/user-path.js";
import type { Fixture } from "./context/fixture.js";
import { registerHost } from "./registration.js";
import type { Provenance } from "./registration.js";

let fixture: Fixture;
let environment: Record<string, string>;

beforeEach(() => {
  fixture = createFixture();
  const userHome = join(fixture.base, "user");
  const pathDirectory = join(fixture.base, "path");
  mkdirSync(userHome, { recursive: true });
  mkdirSync(pathDirectory, { recursive: true });
  environment = { PATH: pathDirectory, HOME: userHome, USERPROFILE: userHome, SHELL: "/bin/sh" };
});

afterEach(() => {
  try {
    fixture.runtime.changes.reverse({ places: fixture.places, host: fixture.host.id });
    expect(userPathEntriesUnder(fixture.base)).toEqual([]);
  } finally {
    fixture.dispose();
  }
});

function provenanceAt(installedAt: string): Provenance {
  return {
    method: "npm",
    version: "1.0.0",
    location: join(fixture.base, "install"),
    os: "linux",
    architecture: "x64",
    installedAt,
  };
}

function identityWithCommand() {
  return { ...fixture.host, commands: [{ name: "thost", target: join(fixture.base, "bin", "thost") }] };
}

function storedProvenance(): unknown {
  return fixture.runtime.registry.get({ places: fixture.places, id: fixture.host.id }).registration?.provenance;
}

describe("registerHost", () => {
  it("refuses an environment with no user home before registering anything", () => {
    const { HOME, USERPROFILE, ...withoutHome } = environment;
    expect(() => registerHost(fixture.runtime, fixture.places, identityWithCommand(), provenanceAt("2026-01-01T00:00:00Z"), withoutHome)).toThrow(/HOME nor USERPROFILE/);
    expect(fixture.runtime.registry.get({ places: fixture.places, id: fixture.host.id }).registration).toBeUndefined();
  });

  it("records the provenance of the first start", () => {
    const first = provenanceAt("2026-01-01T00:00:00Z");
    const registered = registerHost(fixture.runtime, fixture.places, fixture.host, first, environment);
    expect(registered.provenance).toEqual(first);
    expect(storedProvenance()).toEqual(first);
  });

  it("keeps the first provenance when a later start gives a later installedAt", () => {
    const first = provenanceAt("2026-01-01T00:00:00Z");
    registerHost(fixture.runtime, fixture.places, fixture.host, first, environment);
    const registered = registerHost(fixture.runtime, fixture.places, fixture.host, provenanceAt("2026-02-02T00:00:00Z"), environment);
    expect(registered.provenance).toEqual(first);
    expect(storedProvenance()).toEqual(first);
  });

  it("answers the same command name on a second start and requests nothing new", () => {
    const identity = identityWithCommand();
    const provenance = provenanceAt("2026-01-01T00:00:00Z");
    const first = registerHost(fixture.runtime, fixture.places, identity, provenance, environment);
    const second = registerHost(fixture.runtime, fixture.places, identity, provenance, environment);
    expect(first.commands).toHaveLength(1);
    expect(second.commands).toEqual(first.commands);
    const registration = fixture.runtime.registry.get({ places: fixture.places, id: identity.id }).registration;
    expect(registration?.commands).toHaveLength(1);
  });
});
