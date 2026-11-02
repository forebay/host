import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { directoryBundles } from "./bundle-source.js";
import { resolveEnabled } from "./resolve.js";

const SOURCE = directoryBundles(resolve(import.meta.dirname, "..", "__fixtures__", "plugins"));

describe("resolveEnabled", () => {
  it("finds each enabled bundle and reports an absent one missing with its fix", () => {
    const resolved = resolveEnabled([{ id: "a" }, { id: "c" }], SOURCE);
    expect(resolved.found.map((entry) => entry.id)).toEqual(["a"]);
    expect(resolved.missing).toEqual([{ id: "c", fix: "install c, or disable it" }]);
  });

  it("reports a bundle whose version does not match the pin missing", () => {
    const resolved = resolveEnabled([{ id: "a", pin: "1.0.0" }, { id: "b", pin: "9.9.9" }], SOURCE);
    expect(resolved.found.map((entry) => entry.id)).toEqual(["a"]);
    expect(resolved.missing).toEqual([{ id: "b", fix: "install b 9.9.9, or change plugins.b.pin" }]);
  });
});
