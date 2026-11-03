import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startFixtureHost } from "../__fixtures__/running-host.js";
import type { FixtureHost } from "../__fixtures__/running-host.js";
import { detectThroughMethods } from "./detect.js";
import { operate } from "./operate.js";
import { installMethodProviders } from "./providers.js";

const ITEM = "tool";

describe("install-method providers", () => {
  let host: FixtureHost | undefined;

  afterEach(async () => {
    await host?.dispose();
    host = undefined;
  });

  async function started(enabled: string[]): Promise<FixtureHost> {
    host = await startFixtureHost(enabled);
    return host;
  }

  function writeUserMapping(portable: string, mapping: object): void {
    mkdirSync(portable, { recursive: true });
    writeFileSync(join(portable, "packages.json"), JSON.stringify(mapping));
  }

  it("detects, installs, updates and removes a package through the fake provider", async () => {
    const { running } = await started(["fake-install-method"]);
    const manifestPackages = { fake: "left-pad" };

    expect(await detectThroughMethods(running, ITEM, manifestPackages)).toEqual([
      { method: "fake", item: ITEM, package: "left-pad", answer: { installed: false } },
    ]);
    expect(await operate(running, "fake", "install", "left-pad")).toEqual({ ok: true });
    expect(await detectThroughMethods(running, ITEM, manifestPackages)).toEqual([
      { method: "fake", item: ITEM, package: "left-pad", answer: { installed: true, version: "1.0.0" } },
    ]);
    expect(await operate(running, "fake", "update", "left-pad")).toEqual({ ok: true });
    expect(await detectThroughMethods(running, ITEM, manifestPackages)).toEqual([
      { method: "fake", item: ITEM, package: "left-pad", answer: { installed: true, version: "2.0.0" } },
    ]);
    expect(await operate(running, "fake", "remove", "left-pad")).toEqual({ ok: true });
    expect(await detectThroughMethods(running, ITEM, manifestPackages)).toEqual([
      { method: "fake", item: ITEM, package: "left-pad", answer: { installed: false } },
    ]);
  });

  it("answers a provider's own refusal as given", async () => {
    const { running } = await started(["fake-install-method"]);

    expect(await operate(running, "fake", "update", "absent")).toEqual({ ok: false, detail: "absent is not installed", fix: "install absent first" });
  });

  it("lets the user's packages.json override the item's own mapping", async () => {
    const { running } = await started(["fake-install-method"]);
    writeUserMapping(running.places.portable, { [ITEM]: { fake: "mine/tool" } });
    await operate(running, "fake", "install", "mine/tool");

    expect(await detectThroughMethods(running, ITEM, { fake: "theirs/tool" })).toEqual([
      { method: "fake", item: ITEM, package: "mine/tool", answer: { installed: true, version: "1.0.0" } },
    ]);
  });

  it("asks only the methods present in both the mapping and the providers", async () => {
    const { running } = await started(["fake-install-method"]);

    expect(await detectThroughMethods(running, ITEM, { npm: "tool" })).toEqual([]);
  });

  it("refuses a malformed answer naming the provider while another provider's answer still counts", async () => {
    const { running } = await started(["fake-install-method", "broken-install-method"]);
    await operate(running, "fake", "install", "left-pad");

    const detections = await detectThroughMethods(running, ITEM, { fake: "left-pad", broken: "left-pad" });

    expect(detections).toContainEqual({ method: "fake", item: ITEM, package: "left-pad", answer: { installed: true, version: "1.0.0" } });
    const refused = detections.find((detection) => detection.method === "broken");
    expect(refused).toMatchObject({ item: ITEM });
    expect(refused).toHaveProperty("refused", expect.stringContaining("broken-install-method"));
    expect(refused).toHaveProperty("refused", expect.stringContaining("installed"));
  });

  it("turns a refusal without a fix, a bad ok and a throw into refusals naming the provider", async () => {
    const { running } = await started(["broken-install-method"]);

    for (const [operation, issuePath] of [["install", "fix"], ["remove", "ok"], ["update", "update blew up"]] as const) {
      const answer = await operate(running, "broken", operation, "left-pad");
      expect(answer).toMatchObject({ ok: false, detail: expect.stringContaining("broken-install-method") });
      expect(answer).toHaveProperty("detail", expect.stringContaining(issuePath));
    }
  });

  it("refuses an operation no installed provider serves", async () => {
    const { running } = await started(["fake-install-method"]);

    expect(await operate(running, "apt", "install", "git")).toMatchObject({ ok: false, detail: expect.stringContaining("apt") });
  });

  it("serves a method from the first provider and refuses the one it shadows", async () => {
    const { running } = await started(["fake-install-method", "twin-install-method"]);
    const [first, second] = installMethodProviders(running);

    expect(first?.shadowedBy).toBeUndefined();
    expect(second?.shadowedBy).toBe(first?.plugin);
    const detections = await detectThroughMethods(running, ITEM, { fake: "left-pad" });
    expect(detections).toHaveLength(2);
    expect(detections.filter((detection) => "refused" in detection)).toEqual([
      { method: "fake", item: ITEM, refused: expect.stringContaining(`${second?.plugin} is shadowed by ${first?.plugin}`) },
    ]);
  });
});
