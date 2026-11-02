import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFixture, manifestOf } from "../__fixtures__/context.js";
import type { Fixture } from "../__fixtures__/context.js";
import { activityPublisher } from "./activity.js";
import { buildRuntime } from "./build.js";
import { buildConfig } from "./config.js";

const SECRET = "s3cret-value";

let fixture: Fixture;
beforeEach(() => {
  fixture = createFixture();
});
afterEach(() => fixture.dispose());

const manifest = manifestOf("alpha", {
  settings: { token: { type: "secret", label: "Token" }, name: { type: "text", label: "Name" } },
});

function configOf() {
  return buildRuntime(fixture.runtime, fixture.places, fixture.host, manifest, fixture.bus, "2026-11-02T10:00:00.000Z").config;
}

function configFilesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".json") && !path.includes("secrets"))
    .map((path) => join(directory, path));
}

describe("a setting declared secret", () => {
  it("reads back through config but lands in no settings file", async () => {
    const config = configOf();
    await config.set("token", SECRET);
    await config.set("name", "visible");
    expect(config.get("token")).toBe(SECRET);
    const files = configFilesUnder(fixture.base);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(readFileSync(file, "utf8")).not.toContain(SECRET);
  });

  it("is kept in the plugin's own secret store under the setting key", async () => {
    await configOf().set("token", SECRET);
    expect(fixture.runtime.secrets.get({ places: fixture.places, plugin: "alpha", name: "token" }).value).toBe(SECRET);
  });

  it("is left out of all()", async () => {
    const config = configOf();
    await config.set("token", SECRET);
    await config.set("name", "visible");
    expect(config.all()).toEqual({ name: "visible" });
  });

  it("publishes its change without the value", async () => {
    await configOf().set("token", SECRET);
    expect(JSON.stringify(fixture.activity)).not.toContain(SECRET);
    expect(fixture.activity).toEqual([{ source: "alpha", kind: "config.set", detail: { key: "token", secret: true } }]);
  });

  it("is refused, and written nowhere, on a host with no secret store", async () => {
    const config = buildConfig(fixture.runtime, fixture.places, fixture.host, manifest, activityPublisher(fixture.bus, "alpha"), undefined);
    await expect(config.set("token", SECRET)).rejects.toThrow(/no secret store/);
    expect(config.get("token")).toBeUndefined();
  });

  it("refuses a value that is not text", async () => {
    await expect(configOf().set("token", 42)).rejects.toThrow(/secret/);
  });
});
