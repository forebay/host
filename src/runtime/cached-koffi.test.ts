import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let base: string;

async function freshStandIn(): Promise<typeof import("./cached-koffi.js")> {
  vi.resetModules();
  return import("./cached-koffi.js");
}

/** @implNote A stand-in module rather than koffi itself: a loaded native module stays locked on Windows, so its folder could not be removed. */
function laidOutKoffi(name: string): string {
  const directory = join(base, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "index.js"), `module.exports = { load: () => ${JSON.stringify(name)} };`);
  return directory;
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "host-cached-koffi-"));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("the koffi stand-in", () => {
  it("refuses a member read before it is told where koffi is", async () => {
    const standIn = await freshStandIn();
    expect(() => (standIn.default as Record<string, unknown>).load).toThrow(/not been told where koffi is/);
  });

  it("loads koffi from the directory it is given", async () => {
    const standIn = await freshStandIn();
    standIn.useKoffiFrom(laidOutKoffi("koffi"));
    expect(((standIn.default as Record<string, unknown>).load as () => string)()).toBe("koffi");
  });

  it("refuses a second directory once one is loaded, so two runtimes never disagree on koffi", async () => {
    const standIn = await freshStandIn();
    const first = laidOutKoffi("first");
    standIn.useKoffiFrom(first);
    expect(typeof (standIn.default as Record<string, unknown>).load).toBe("function");
    standIn.useKoffiFrom(first);
    standIn.useKoffiFrom(join(first, "..", "first"));
    expect(() => standIn.useKoffiFrom(join(base, "second"))).toThrow(/already loaded/);
  });
});
