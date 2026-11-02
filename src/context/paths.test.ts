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

describe("paths", () => {
  it("gives each plugin its own portable and cache folders", () => {
    const { paths } = buildRuntime(fixture.runtime, fixture.places, fixture.host, manifestOf("alpha"), fixture.bus, "t");
    expect(paths.portable).toBe(join(fixture.places.portable, "plugins", "alpha"));
    expect(paths.cache).toBe(join(fixture.places.cache, "plugins", "alpha"));
    expect(paths.home).toBe(fixture.host.home);
  });
});
