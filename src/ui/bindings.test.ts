import { DEFAULT_CALL_TIMEOUT_MS, DEFAULT_INVOKE_TIMEOUT_MS } from "@weivel/typescript/host";
import { afterEach, describe, expect, it } from "vitest";
import { HandClock, startFixtureHost } from "../__fixtures__/running-host.js";
import type { FixtureHost } from "../__fixtures__/running-host.js";
import { callBinding, runAction } from "./bindings.js";

let fixture: FixtureHost | undefined;

async function hostWith(enabled: string[], clock?: HandClock): Promise<FixtureHost> {
  fixture = await startFixtureHost(enabled, clock);
  return fixture;
}

afterEach(async () => {
  await fixture?.dispose();
  fixture = undefined;
});

describe("callBinding", () => {
  it("answers what the bound method returned", async () => {
    const { running } = await hostWith(["viewer"]);
    expect(await callBinding(running, "viewer", { service: "viewer:status", method: "rows" })).toEqual({
      ok: true,
      value: { items: [{ id: "x", state: "detected" }] },
    });
  });

  it("merges the extra argument over the declared one", async () => {
    const { running } = await hostWith(["viewer"]);
    const answer = await callBinding(running, "viewer", { service: "viewer:status", method: "echo", argument: { item: "declared", keep: 1 } }, { item: "x" });
    expect(answer).toEqual({ ok: true, value: { item: "x", keep: 1 } });
  });

  it("refuses a service the plugin consumes but does not provide, even when another plugin provides it", async () => {
    const { running } = await hostWith(["a", "viewer"]);
    expect(running.loaded.host.service("demo:greeting")).toBeDefined();
    const answer = await callBinding(running, "viewer", { service: "demo:greeting", method: "call" });
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.error.detail).toContain("demo:greeting");
  });

  it("answers a failure rather than throwing when the method throws", async () => {
    const { running } = await hostWith(["viewer"]);
    const answer = await callBinding(running, "viewer", { service: "viewer:status", method: "fails" });
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.error.detail).toContain("the status file is unreadable");
    expect(running.status().quarantined).toEqual([]);
  });

  it("answers a failure for a method the service does not have", async () => {
    const { running } = await hostWith(["viewer"]);
    const answer = await callBinding(running, "viewer", { service: "viewer:status", method: "missing" });
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.error.detail).toContain("missing");
  });

  it("gives up after the call deadline on the host's own clock", async () => {
    const clock = new HandClock();
    const { running } = await hostWith(["viewer"], clock);
    const startup = clock.delays.length;
    const pending = callBinding(running, "viewer", { service: "viewer:status", method: "hangs" });
    await clock.fireOnceScheduled();
    expect((await pending).ok).toBe(false);
    expect(clock.delays.slice(startup)).toEqual([DEFAULT_CALL_TIMEOUT_MS]);
  });
});

describe("runAction", () => {
  it("calls the action's binding with the row's item merged over its declared argument", async () => {
    const { running } = await hostWith(["viewer"]);
    expect(await runAction(running, "viewer", "restart", { item: "x" })).toEqual({ ok: true, value: { force: true, item: "x" } });
  });

  it("calls the action's binding with its declared argument alone", async () => {
    const { running } = await hostWith(["viewer"]);
    expect(await runAction(running, "viewer", "restart")).toEqual({ ok: true, value: { force: true, item: "declared" } });
  });

  it("waits on the invoke deadline, not the read deadline", async () => {
    const clock = new HandClock();
    const { running } = await hostWith(["viewer"], clock);
    const startup = clock.delays.length;
    await runAction(running, "viewer", "restart");
    expect(clock.delays.slice(startup)).toEqual([DEFAULT_INVOKE_TIMEOUT_MS]);
  });

  it("answers a failure for an action the plugin does not declare", async () => {
    const { running } = await hostWith(["viewer"]);
    const answer = await runAction(running, "viewer", "explode");
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.error.detail).toContain("explode");
  });
});
