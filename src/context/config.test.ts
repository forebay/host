import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRuntime } from "./build.js";
import { createFixture, manifestOf } from "./fixture.js";
import type { Fixture } from "./fixture.js";

let fixture: Fixture;
beforeEach(() => {
  fixture = createFixture();
});
afterEach(() => fixture.dispose());

const manifest = manifestOf("alpha", {
  settings: { shared: { type: "text", label: "Shared", layer: "portable" }, local: { type: "text", label: "Local", layer: "application" } },
});

function configOf() {
  return buildRuntime(fixture.runtime, fixture.places, fixture.host, manifest, fixture.bus, "2026-11-02T10:00:00.000Z").config;
}

function portableFile(): string {
  return join(fixture.places.portable, "plugins", "alpha", "config.json");
}

describe("config layers", () => {
  it("writes a declared portable setting without a layer into the portable plugin folder", async () => {
    await configOf().set("shared", "v");
    expect(JSON.parse(readFileSync(portableFile(), "utf8"))).toEqual({ shared: "v" });
  });

  it("writes an undeclared key without a layer into the application config file", async () => {
    await configOf().set("whatever", 3);
    const file = join(fixture.host.home, "config", "alpha.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ whatever: 3 });
    expect(existsSync(portableFile())).toBe(false);
  });

  it("lets an explicit layer win over the declared one", async () => {
    await configOf().set("shared", "v", { layer: "application" });
    expect(JSON.parse(readFileSync(join(fixture.host.home, "config", "alpha.json"), "utf8"))).toEqual({ shared: "v" });
    expect(existsSync(portableFile())).toBe(false);
  });

  it("refuses a value JSON cannot carry and writes nothing", async () => {
    await expect(configOf().set("shared", undefined)).rejects.toThrow(/cannot be carried as JSON/);
    expect(existsSync(portableFile())).toBe(false);
    expect(fixture.activity).toEqual([]);
  });

  it("publishes activity with the key, the previous value and the new one", async () => {
    const config = configOf();
    await config.set("local", "one");
    await config.set("local", "two");
    expect(fixture.activity).toEqual([
      { source: "alpha", kind: "config.set", detail: { key: "local", from: undefined, to: "one" } },
      { source: "alpha", kind: "config.set", detail: { key: "local", from: "one", to: "two" } },
    ]);
  });
});
