import { describe, expect, it } from "vitest";
import { checkedAnswer } from "./answer-checks.js";

const SERIES = [{ label: "load", points: [1, 2, 3] }];

describe("checkedAnswer", () => {
  it("answers one checked result per check, in the order the plan named them", () => {
    const checked = checkedAnswer([{ against: "text" }, { against: "chart", members: ["series"] }], { text: "hi" });
    expect(checked.map((result) => result.against)).toEqual(["text", "chart"]);
    expect(checked[0]).toEqual({ against: "text", issues: [] });
  });

  it("checks only the members a check names, so a valid other branch never lets an answer through", () => {
    const [checked] = checkedAnswer([{ against: "chart", members: ["series"] }], { value: 3, maximum: 10 });
    expect(checked).toMatchObject({ against: "chart", members: ["series"] });
    expect(checked?.issues.map((issue) => issue.path)).toContain("series");
  });

  it("passes a measure that the members it reads hold", () => {
    expect(checkedAnswer([{ against: "progress", members: ["value", "maximum"] }], { series: SERIES, value: 3, maximum: 10 })).toEqual([{ against: "progress", members: ["value", "maximum"], issues: [] }]);
  });

  it("answers no issues for a definition the engine has no schema for", () => {
    expect(checkedAnswer([{ against: "stack" }, { against: "form" }], "anything")).toEqual([
      { against: "stack", issues: [] },
      { against: "form", issues: [] },
    ]);
  });

  it("projects an array answer to a chart as an object with no series, and reports the missing series", () => {
    const [checked] = checkedAnswer([{ against: "chart", members: ["series"] }], SERIES);
    expect(checked?.issues.length).toBeGreaterThan(0);
    expect(checked?.issues[0]?.path ?? "").toBe("series");
  });

  it("checks a scalar answer whole even when the check names members", () => {
    const [checked] = checkedAnswer([{ against: "chart", members: ["series"] }], "oops");
    expect(checked?.issues.length).toBeGreaterThan(0);
  });
});
