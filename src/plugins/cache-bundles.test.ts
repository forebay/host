import { describe, expect, it } from "vitest";
import type { Runtime } from "../runtime/open.js";
import { cacheBundles } from "./cache-bundles.js";

type Locate = Runtime["cache"]["locate"];
type Answer = ReturnType<Locate>;

function runtimeAnswering(answer: (plugins: Record<string, string>) => Answer): { runtime: Pick<Runtime, "cache">; asked: Record<string, string>[] } {
  const asked: Record<string, string>[] = [];
  const locate: Locate = ({ plugins }) => {
    asked.push(plugins);
    return answer(plugins);
  };
  return { runtime: { cache: { locate } }, asked };
}

const LOCATED: Answer = { located: [{ id: "a", version: "1.0.0", directory: "/c/bundles/a/1.0.0", manifest: "/c/bundles/a/1.0.0/plugin.json", entry: "/c/bundles/a/1.0.0/index.js" }], problems: [] };
const DAMAGED: Answer = { located: [], problems: [{ id: "a", version: "1.0.0", detail: "index.js is short", fix: "install it again", file: "index.js" }] };

describe("cacheBundles", () => {
  it("answers each bundle cache.locate found as an entry, an absent entry as null", () => {
    const { runtime } = runtimeAnswering(() => ({ located: [{ ...(LOCATED.located[0] as Answer["located"][number]), entry: undefined }], problems: [] }));
    const entry = cacheBundles(runtime, "/c", { a: "1.0.0" }).locate("a");
    expect(entry).toEqual({ id: "a", version: "1.0.0", manifestPath: "/c/bundles/a/1.0.0/plugin.json", entryPath: null });
  });

  it("asks cache.locate for every version it was given on list, and for one id on locate", () => {
    const { runtime, asked } = runtimeAnswering(() => LOCATED);
    const bundles = cacheBundles(runtime, "/c", { b: "1.0.0", a: "1.0.0" });
    bundles.list();
    bundles.locate("a");
    expect(asked).toEqual([{ b: "1.0.0", a: "1.0.0" }, { a: "1.0.0" }]);
  });

  it("locates nothing for an id it was not given, without asking", () => {
    const { runtime, asked } = runtimeAnswering(() => LOCATED);
    expect(cacheBundles(runtime, "/c", { a: "1.0.0" }).locate("other")).toBeNull();
    expect(asked).toEqual([]);
  });

  it("keeps each id's latest problem and drops it once the id locates cleanly", () => {
    let answer = DAMAGED;
    const { runtime } = runtimeAnswering(() => answer);
    const bundles = cacheBundles(runtime, "/c", { a: "1.0.0" });
    expect(bundles.locate("a")).toBeNull();
    expect(bundles.problems()).toEqual(DAMAGED.problems);
    answer = LOCATED;
    expect(bundles.locate("a")?.id).toBe("a");
    expect(bundles.problems()).toEqual([]);
  });
});
