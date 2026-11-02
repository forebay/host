import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { directoryBundles } from "./bundle-source.js";
import { selectPlugins } from "./selection.js";

const SOURCE = directoryBundles(resolve(import.meta.dirname, "..", "__fixtures__", "plugins"));
const DEFAULTS = { "demo:greeting": "a" };

function selectedIds(settings: Record<string, unknown>) {
  const selection = selectPlugins(settings, SOURCE, ["demo:greeting"], DEFAULTS);
  return { bundles: selection.bundles.map((entry) => entry.id), missing: selection.missing };
}

describe("selectPlugins", () => {
  it("adds a default provider whose pin its bundle matches", () => {
    expect(selectedIds({ plugins: { a: { pin: "1.0.0" } } })).toEqual({ bundles: ["a"], missing: [] });
  });

  it("reports a default provider whose pin its bundle does not match missing, like an enabled one", () => {
    expect(selectedIds({ plugins: { a: { pin: "9.9.9" } } })).toEqual({
      bundles: [],
      missing: [{ id: "a", fix: "install a 9.9.9, or change plugins.a.pin" }],
    });
  });

  it("does not add a default provider the settings disable", () => {
    expect(selectedIds({ plugins: { a: { enabled: false } } })).toEqual({ bundles: [], missing: [] });
  });
});
