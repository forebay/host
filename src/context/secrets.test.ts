import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRuntime } from "./build.js";
import { createFixture, manifestOf } from "../__fixtures__/context.js";
import type { Fixture } from "../__fixtures__/context.js";

let fixture: Fixture;
beforeEach(() => {
  fixture = createFixture();
});
afterEach(() => fixture.dispose());

function secretsOf(id: string) {
  const { secrets } = buildRuntime(fixture.runtime, fixture.places, fixture.host, manifestOf(id), fixture.bus, "t");
  if (secrets === undefined) throw new Error("no secrets");
  return secrets;
}

describe("secrets", () => {
  it("keeps two plugins' secrets of the same name independent", async () => {
    await secretsOf("alpha").set("token", "one");
    await secretsOf("beta").set("token", "two");
    expect(await secretsOf("alpha").get("token")).toBe("one");
    expect(await secretsOf("beta").get("token")).toBe("two");
    await secretsOf("alpha").delete("token");
    expect(await secretsOf("alpha").get("token")).toBeUndefined();
    expect(await secretsOf("beta").get("token")).toBe("two");
  });
});
