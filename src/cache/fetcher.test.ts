import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CacheRefusal } from "./cache-refusal.js";
import { defaultFetcher, fetcherWith } from "./fetcher.js";

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "host-fetcher-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function answering(response: Response): typeof fetch {
  return async () => response;
}

describe("defaultFetcher", () => {
  it("reads a file url from disk", async () => {
    const path = join(directory, "a b.js");
    writeFileSync(path, "bytes");
    const bytes = await defaultFetcher().fetch(pathToFileURL(path).href);
    expect(Buffer.from(bytes).toString()).toBe("bytes");
  });

  it("refuses a file url carrying an encoded slash instead of decoding it", async () => {
    const url = `${pathToFileURL(directory).href}/a%2fb.js`;
    await expect(defaultFetcher().fetch(url)).rejects.toBeInstanceOf(CacheRefusal);
  });

  it("fetches an https url through the fetch it is given", async () => {
    const fetcher = fetcherWith({ fetchImplementation: answering(new Response("served")) });
    expect(Buffer.from(await fetcher.fetch("https://e.com/p.js")).toString()).toBe("served");
  });

  it("refuses an https answer that is not ok, naming the status", async () => {
    const fetcher = fetcherWith({ fetchImplementation: answering(new Response("gone", { status: 404 })) });
    await expect(fetcher.fetch("https://e.com/p.js")).rejects.toThrow(/404/);
  });

  it("refuses an https fetch that outlives its deadline", async () => {
    const never: typeof fetch = () => new Promise(() => {});
    const fetcher = fetcherWith({ fetchImplementation: never, deadlineMs: 20 });
    await expect(fetcher.fetch("https://e.com/p.js")).rejects.toThrow(/did not finish within 20 ms/);
  });

  it("refuses a file url that names a host, which on Windows is a network share", async () => {
    await expect(defaultFetcher().fetch("file://server/share/p.js")).rejects.toThrow(/names the host server/);
  });

  it("refuses any other scheme", async () => {
    await expect(defaultFetcher().fetch("ftp://e.com/p.js")).rejects.toThrow(/ftp:/);
    await expect(defaultFetcher().fetch("http://e.com/p.js")).rejects.toBeInstanceOf(CacheRefusal);
  });
});
