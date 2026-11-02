import { afterEach, describe, expect, it } from "vitest";
import { startFixtureHost } from "../__fixtures__/running-host.js";
import type { FixtureHost } from "../__fixtures__/running-host.js";
import { bindingTarget } from "./binding-target.js";

let fixture: FixtureHost | undefined;

async function hostWith(enabled: string[]): Promise<FixtureHost> {
  fixture = await startFixtureHost(enabled);
  return fixture;
}

afterEach(async () => {
  await fixture?.dispose();
  fixture = undefined;
});

describe("bindingTarget", () => {
  it("answers the bound plugin's own implementation when it is the only active provider", async () => {
    const { running } = await hostWith(["greeter"]);
    const target = bindingTarget(running, "greeter", "demo:greeting");
    expect(target.state).toBe("callable");
    if (target.state === "callable") expect((target.implementation.greet as () => unknown)()).toEqual({ text: "from greeter" });
  });

  it("refuses a service more than one active plugin provides, since it cannot name the bound plugin's own", async () => {
    const { running } = await hostWith(["greeter", "silent"]);
    expect(running.status().active.sort()).toEqual(["greeter", "silent"]);
    expect(running.loaded.host.service("demo:greeting")).toBeDefined();
    const target = bindingTarget(running, "silent", "demo:greeting");
    expect(target.state).toBe("refused");
    if (target.state !== "callable") expect(target.error.detail).toContain("greeter");
  });

  it("answers unavailable for a quarantined bound plugin even while another plugin provides the id", async () => {
    const { running } = await hostWith(["greeter", "rival"]);
    expect(running.status().quarantined.map((entry) => entry.id)).toEqual(["rival"]);
    expect(running.loaded.host.service("demo:greeting")).toBeDefined();
    expect(bindingTarget(running, "rival", "demo:greeting").state).toBe("unavailable");
  });

  it("answers unavailable for a deployed plugin that never started", async () => {
    const { running } = await hostWith(["dormant"]);
    expect(bindingTarget(running, "dormant", "dormant:status").state).toBe("unavailable");
  });

  it("refuses a service the bound plugin does not provide", async () => {
    const { running } = await hostWith(["a", "viewer"]);
    expect(bindingTarget(running, "viewer", "demo:greeting").state).toBe("refused");
  });

  it("refuses a plugin the host did not deploy", async () => {
    const { running } = await hostWith(["viewer"]);
    expect(bindingTarget(running, "absent", "absent:status").state).toBe("refused");
  });
});
