import { describe, expect, it } from "vitest";
import { disabledPlugins, enabledPlugins, pinnedVersions } from "./enabled.js";

describe("enabledPlugins", () => {
  it("answers every plugin enabled exactly true, ordered by id, with its pin", () => {
    const settings = {
      plugins: {
        zeta: { enabled: true },
        alpha: { enabled: true, pin: "2.1.0" },
        off: { enabled: false },
        truthy: { enabled: "yes" },
        bare: {},
      },
    };
    expect(enabledPlugins(settings)).toEqual([{ id: "alpha", pin: "2.1.0" }, { id: "zeta" }]);
  });

  it("answers nothing when the settings carry no plugins object", () => {
    expect(enabledPlugins({})).toEqual([]);
    expect(enabledPlugins({ plugins: ["a"] })).toEqual([]);
  });
});

describe("disabledPlugins", () => {
  it("answers only the plugins enabled is explicitly false for, ordered by id", () => {
    const settings = { plugins: { zeta: { enabled: false }, alpha: { enabled: false }, on: { enabled: true }, bare: {} } };
    expect(disabledPlugins(settings)).toEqual(["alpha", "zeta"]);
  });
});

describe("pinnedVersions", () => {
  it("answers every string pin, whether or not the plugin is enabled", () => {
    const settings = { plugins: { a: { pin: "1.0.0" }, b: { enabled: true, pin: "2.0.0" }, c: { pin: 3 } } };
    expect(pinnedVersions(settings)).toEqual({ a: "1.0.0", b: "2.0.0" });
  });
});
