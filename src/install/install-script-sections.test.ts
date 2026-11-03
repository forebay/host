import { describe, expect, it } from "vitest";
import { ps1Quoted, shQuoted } from "./install-script-sections.js";

describe("shQuoted", () => {
  it("closes, escapes and reopens the quote around a single quote", () => {
    expect(shQuoted("it's")).toBe(String.raw`'it'\''s'`);
  });

  it("quotes a value with no single quote as it is", () => {
    expect(shQuoted("a b$c")).toBe("'a b$c'");
  });
});

describe("ps1Quoted", () => {
  it("doubles a single quote", () => {
    expect(ps1Quoted("it's")).toBe("'it''s'");
  });
});
