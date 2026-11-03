import { describe, expect, it } from "vitest";
import { compareVersions, newestVersion } from "./semver.js";

describe("compareVersions", () => {
  it("orders by major, minor and patch as numbers", () => {
    expect(["1.10.0", "1.2.0", "1.9.3", "0.9.9"].sort(compareVersions)).toEqual(["0.9.9", "1.2.0", "1.9.3", "1.10.0"]);
  });

  it("orders a prerelease before its release, numeric identifiers as numbers", () => {
    expect(["1.0.0", "1.0.0-beta.10", "1.0.0-beta.2", "1.0.0-alpha"].sort(compareVersions)).toEqual(["1.0.0-alpha", "1.0.0-beta.2", "1.0.0-beta.10", "1.0.0"]);
  });

  it("orders a name that is not a version below every version", () => {
    expect(["1.0.0", "latest"].sort(compareVersions)).toEqual(["latest", "1.0.0"]);
  });
});

describe("newestVersion", () => {
  it("answers the highest version, or undefined for none", () => {
    expect(newestVersion(["1.0.0", "2.0.0-rc.1", "1.5.0"])).toBe("2.0.0-rc.1");
    expect(newestVersion([])).toBeUndefined();
  });
});
