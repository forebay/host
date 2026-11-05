import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRuntime } from "./build.js";
import { buildSecrets } from "./secrets.js";
import type { Runtime } from "../runtime/open.js";
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

describe("a secret store that refuses", () => {
  const REFUSAL = { refused: "the secret store is locked", fix: "unlock the keychain and retry" };
  const refusing = (): ReturnType<typeof buildSecrets> => {
    const runtime = { secrets: { get: () => REFUSAL, set: () => REFUSAL, delete: () => REFUSAL } } as unknown as Runtime;
    return buildSecrets(runtime, fixture.places, "alpha");
  };

  it("makes get throw the refusal's cause and fix rather than answer an absent secret", async () => {
    await expect(refusing().get("token")).rejects.toMatchObject({ name: "HostRefusal", detail: REFUSAL.refused, fix: REFUSAL.fix });
  });

  it("makes set throw the refusal's cause and fix rather than report a store", async () => {
    await expect(refusing().set("token", "v")).rejects.toMatchObject({ name: "HostRefusal", detail: REFUSAL.refused, fix: REFUSAL.fix });
  });

  it("makes delete throw the refusal's cause and fix", async () => {
    await expect(refusing().delete("token")).rejects.toMatchObject({ name: "HostRefusal", detail: REFUSAL.refused, fix: REFUSAL.fix });
  });

  it("still answers an absent secret as undefined when the store simply has none", async () => {
    expect(await secretsOf("alpha").get("never-set")).toBeUndefined();
  });
});
