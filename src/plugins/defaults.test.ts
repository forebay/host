import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { directoryBundles } from "./bundle-source.js";
import { withDefaults } from "./defaults.js";

const SOURCE = directoryBundles(resolve(import.meta.dirname, "..", "__fixtures__", "plugins"));
const DEFAULTS = { "demo:greeting": "a" };

describe("withDefaults", () => {
  it("adds the default provider of a service the host consumes and nothing enabled provides", () => {
    expect(withDefaults([], SOURCE, ["demo:greeting"], DEFAULTS, [])).toEqual(["a"]);
  });

  it("adds the default provider of a service an enabled plugin consumes", () => {
    expect(withDefaults(["b"], SOURCE, [], DEFAULTS, [])).toEqual(["b", "a"]);
  });

  it("adds nothing when an enabled plugin already provides the service", () => {
    expect(withDefaults(["z", "b"], SOURCE, ["demo:greeting"], DEFAULTS, [])).toEqual(["z", "b"]);
  });

  it("never adds a plugin the settings explicitly disable", () => {
    expect(withDefaults(["b"], SOURCE, ["demo:greeting"], DEFAULTS, ["a"])).toEqual(["b"]);
  });

  it("adds nothing for a service a plugin consumes only optionally", () => {
    expect(withDefaults(["optional-reader"], SOURCE, [], DEFAULTS, [])).toEqual(["optional-reader"]);
  });

  it("adds nothing when the source does not hold the default", () => {
    expect(withDefaults([], SOURCE, ["demo:greeting"], { "demo:greeting": "absent" }, [])).toEqual([]);
  });
});
