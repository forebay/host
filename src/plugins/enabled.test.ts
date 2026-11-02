import { describe, expect, it } from "vitest";
import { enabledPlugins } from "./enabled.js";

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
