import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FileRef } from "../catalog/catalog.js";
import type { Fetcher } from "./fetcher.js";
import { storeFile, storeFileWith } from "./store.js";

let cache: string;

beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), "host-store-"));
});

afterEach(() => {
  rmSync(cache, { recursive: true, force: true });
});

const CONTENT = Buffer.from("export default {};");

function referenceTo(content: Buffer): FileRef {
  return { url: "https://e.com/p.js", sha256: createHash("sha256").update(content).digest("hex"), size: content.length };
}

function serving(content: Buffer): Fetcher & { calls: number } {
  const fetcher = {
    calls: 0,
    async fetch() {
      fetcher.calls += 1;
      return new Uint8Array(content);
    },
  };
  return fetcher;
}

describe("storeFile", () => {
  it("fetches into a fresh store, then answers cached without fetching", async () => {
    const path = join(cache, "bundles", "a", "1.0.0", "p.js");
    const fetcher = serving(CONTENT);
    expect(await storeFile(referenceTo(CONTENT), path, fetcher)).toBe("fetched");
    expect(readFileSync(path)).toEqual(CONTENT);
    fetcher.calls = 0;
    expect(await storeFile(referenceTo(CONTENT), path, fetcher)).toBe("cached");
    expect(fetcher.calls).toBe(0);
  });

  it("refetches a cached file whose hash no longer matches", async () => {
    const path = join(cache, "p.js");
    writeFileSync(path, "corrupted");
    expect(await storeFile(referenceTo(CONTENT), path, serving(CONTENT))).toBe("fetched");
    expect(readFileSync(path)).toEqual(CONTENT);
  });

  it("refuses a source serving other bytes, naming the url and the expected hash, and writes nothing", async () => {
    const target = join(cache, "bundles", "a", "1.0.0");
    const reference = referenceTo(CONTENT);
    const other = Buffer.from("export default 1;;");
    const claimed = { ...reference, size: other.length };
    await expect(storeFile(claimed, join(target, "p.js"), serving(other))).rejects.toThrow(reference.sha256);
    await expect(storeFile(claimed, join(target, "p.js"), serving(other))).rejects.toThrow(reference.url);
    expect(existsSync(target)).toBe(false);
  });

  it("refuses a fetched file whose length differs from the size, even when the hash matches", async () => {
    const path = join(cache, "p.js");
    await expect(storeFile({ ...referenceTo(CONTENT), size: CONTENT.length + 1 }, path, serving(CONTENT))).rejects.toThrow(/bytes/);
    expect(existsSync(path)).toBe(false);
  });

  it("lets two concurrent stores of one path both succeed", async () => {
    const path = join(cache, "p.js");
    const answers = await Promise.all([storeFile(referenceTo(CONTENT), path, serving(CONTENT)), storeFile(referenceTo(CONTENT), path, serving(CONTENT))]);
    expect(answers).toEqual(["fetched", "fetched"]);
    expect(readFileSync(path)).toEqual(CONTENT);
    expect(readdirSync(cache)).toEqual(["p.js"]);
  });

  it("accepts a destination another process already wrote with the right bytes when its own rename fails", async () => {
    const path = join(cache, "p.js");
    const lockedByAnotherHost = async () => {
      writeFileSync(path, CONTENT);
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    };
    expect(await storeFileWith(referenceTo(CONTENT), path, serving(CONTENT), { rename: lockedByAnotherHost })).toBe("fetched");
    expect(readdirSync(cache)).toEqual(["p.js"]);
  });

  it("refuses when its rename fails and the destination holds other bytes", async () => {
    const path = join(cache, "p.js");
    const lockedWithOtherBytes = async () => {
      writeFileSync(path, "other");
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    };
    await expect(storeFileWith(referenceTo(CONTENT), path, serving(CONTENT), { rename: lockedWithOtherBytes })).rejects.toThrow(/EPERM/);
    expect(readdirSync(cache)).toEqual(["p.js"]);
  });

  it("leaves no temporary file behind, even when the rename into place fails", async () => {
    const path = join(cache, "p.js");
    mkdirSync(join(path, "occupied"), { recursive: true });
    await expect(storeFile(referenceTo(CONTENT), path, serving(CONTENT))).rejects.toThrow(/could not be written/);
    expect(readdirSync(cache)).toEqual(["p.js"]);
  });
});
