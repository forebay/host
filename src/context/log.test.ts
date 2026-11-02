import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

function logContents(): string {
  const logs = join(fixture.host.home, "logs");
  const day = readdirSync(logs)[0] as string;
  const file = readdirSync(join(logs, day))[0] as string;
  return readFileSync(join(logs, day, file), "utf8");
}

describe("logger", () => {
  it("writes an error with a cause as message colon cause and publishes activity", () => {
    const { log } = buildRuntime(fixture.runtime, fixture.places, fixture.host, manifestOf("alpha"), fixture.bus, "2026-11-02T10:00:00.000Z");
    log.error("x", new Error("y"));
    expect(logContents()).toContain("[ERROR] x: y");
    expect(fixture.activity).toEqual([{ source: "alpha", kind: "log.error", detail: { message: "x: y" } }]);
  });

  it("swallows a throwing activity bus", () => {
    const throwing = { publish: () => { throw new Error("bus down"); }, subscribe: () => () => {} };
    const { log } = buildRuntime(fixture.runtime, fixture.places, fixture.host, manifestOf("alpha"), throwing, "2026-11-02T10:00:00.000Z");
    expect(() => log.error("x", new Error("y"))).not.toThrow();
    expect(logContents()).toContain("[ERROR] x: y");
  });

  it("swallows a failing write", () => {
    mkdirSync(fixture.host.home, { recursive: true });
    writeFileSync(join(fixture.host.home, "logs"), "a file where the log directory belongs");
    const { log } = buildRuntime(fixture.runtime, fixture.places, fixture.host, manifestOf("alpha"), fixture.bus, "2026-11-02T10:00:00.000Z");
    expect(() => log.warn("hello")).not.toThrow();
  });
});
