import { describe, expect, it } from "vitest";
import { userHomeOf } from "./user-home.js";

describe("userHomeOf", () => {
  it("prefers USERPROFILE on win32", () => {
    expect(userHomeOf({ USERPROFILE: "C:profile-a", HOME: "/msys/u" }, "win32")).toBe("C:profile-a");
  });

  it("prefers HOME elsewhere", () => {
    expect(userHomeOf({ USERPROFILE: "C:profile-a", HOME: "/home/u" }, "linux")).toBe("/home/u");
  });

  it("refuses an environment with neither, naming both", () => {
    expect(() => userHomeOf({ PATH: "/bin" }, "linux")).toThrow(/HOME nor USERPROFILE/);
  });
});
