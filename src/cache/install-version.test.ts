import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CatalogItem, FileRef } from "../catalog/catalog.js";
import type { Fetcher } from "./fetcher.js";
import { cacheBundleSource } from "./cache-bundle-source.js";
import { installVersion } from "./install-version.js";

let cache: string;

beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), "host-install-"));
});

afterEach(() => {
  rmSync(cache, { recursive: true, force: true });
});

const served: Record<string, string> = {
  "https://e.com/plugin.json": '{"id":"a","api":1,"version":"1.0.0","entry":"index.js"}',
  "https://e.com/index.js": "export default {};",
  "https://e.com/liba.so": "elf",
};

const fetcher: Fetcher = {
  async fetch(url) {
    return new Uint8Array(Buffer.from(served[url] ?? ""));
  },
};

function reference(url: string): FileRef {
  const content = Buffer.from(served[url] ?? "");
  return { url, sha256: createHash("sha256").update(content).digest("hex"), size: content.length };
}

const plugin: CatalogItem = {
  kind: "plugin",
  latest: "1.0.0",
  versions: { "1.0.0": { files: { "plugin.json": reference("https://e.com/plugin.json"), "dist/index.js": reference("https://e.com/index.js") } } },
};

const linuxOnlyLibrary: CatalogItem = {
  kind: "library",
  latest: "2.0.0",
  versions: { "2.0.0": { platforms: { "linux-x64": { files: { "liba.so": reference("https://e.com/liba.so") } } } } },
};

describe("installVersion", () => {
  it("installs a plugin's files into its bundle version directory", async () => {
    const installed = await installVersion(cache, "a", plugin, "1.0.0", fetcher, "linux-x64");
    const directory = join(cache, "bundles", "a", "1.0.0");
    expect(installed).toEqual({ ok: true, id: "a", version: "1.0.0", directory, fetched: ["plugin.json", "dist/index.js"], cached: [] });
    expect(readFileSync(join(directory, "dist", "index.js"), "utf8")).toBe("export default {};");
  });

  it("marks a version complete last, naming every file and its hash", async () => {
    await installVersion(cache, "a", plugin, "1.0.0", fetcher, "linux-x64");
    const marker = JSON.parse(readFileSync(join(cache, "bundles", "a", "1.0.0", ".installed.json"), "utf8"));
    const files = plugin.versions["1.0.0"]?.files ?? {};
    expect(marker).toEqual({ files: { "plugin.json": files["plugin.json"]?.sha256, "dist/index.js": files["dist/index.js"]?.sha256 } });
  });

  it("leaves no runnable version when the second of two files is refused", async () => {
    const failingSecond: Fetcher = {
      async fetch(url) {
        return url.endsWith("index.js") ? new Uint8Array(Buffer.from("export default 1;")) : fetcher.fetch(url);
      },
    };
    const refused = await installVersion(cache, "a", plugin, "1.0.0", failingSecond, "linux-x64");
    expect(refused).toMatchObject({ ok: false, file: "dist/index.js" });
    expect(readdirSync(join(cache, "bundles", "a", "1.0.0"))).not.toContain(".installed.json");
    expect(cacheBundleSource(cache, { a: "1.0.0" }).locate("a")).toBeNull();
  });

  it("refuses as ambiguous a file listed both for every platform and for this one, writing nothing", async () => {
    const ambiguous: CatalogItem = {
      kind: "library",
      latest: "2.0.0",
      versions: { "2.0.0": { files: { "liba.so": reference("https://e.com/liba.so") }, platforms: { "linux-x64": { files: { "liba.so": reference("https://e.com/liba.so") } } } } },
    };
    const refused = await installVersion(cache, "liba", ambiguous, "2.0.0", fetcher, "linux-x64");
    expect(refused).toMatchObject({ ok: false, file: "liba.so" });
    expect(existsSync(join(cache, "libraries"))).toBe(false);
  });

  it("refuses a file that would take the completion marker's name", async () => {
    const shadowing: CatalogItem = { kind: "plugin", latest: "1.0.0", versions: { "1.0.0": { files: { ".installed.json": reference("https://e.com/index.js") } } } };
    const refused = await installVersion(cache, "a", shadowing, "1.0.0", fetcher, "linux-x64");
    expect(refused).toMatchObject({ ok: false, file: ".installed.json" });
    expect(existsSync(join(cache, "bundles"))).toBe(false);
  });

  it("answers cached for every file on a second install", async () => {
    await installVersion(cache, "a", plugin, "1.0.0", fetcher, "linux-x64");
    const again = await installVersion(cache, "a", plugin, "1.0.0", fetcher, "linux-x64");
    expect(again).toMatchObject({ ok: true, fetched: [], cached: ["plugin.json", "dist/index.js"] });
  });

  it("installs a library's files for the platform into its library directory", async () => {
    const installed = await installVersion(cache, "liba", linuxOnlyLibrary, "2.0.0", fetcher, "linux-x64");
    expect(installed.ok).toBe(true);
    expect(readdirSync(join(cache, "libraries", "liba", "2.0.0", "linux-x64")).sort()).toEqual([".installed.json", "liba.so"]);
  });

  it("refuses an item not built for this platform with the fix", async () => {
    const refused = await installVersion(cache, "liba", linuxOnlyLibrary, "2.0.0", fetcher, "win32-x64");
    expect(refused).toEqual({
      ok: false,
      id: "liba",
      version: "2.0.0",
      detail: "not built for win32-x64",
      fix: "use a platform the item lists, or ask its publisher for a win32-x64 build",
    });
    expect(existsSync(join(cache, "libraries"))).toBe(false);
  });

  it("refuses a version the item does not list", async () => {
    const refused = await installVersion(cache, "a", plugin, "9.9.9", fetcher, "linux-x64");
    expect(refused.ok).toBe(false);
  });

  it("refuses a file whose destination escapes the version directory, writing nothing", async () => {
    const escaping: CatalogItem = {
      kind: "plugin",
      latest: "1.0.0",
      versions: { "1.0.0": { files: { "index.js": reference("https://e.com/index.js"), "../../escaped.js": reference("https://e.com/index.js") } } },
    };
    const refused = await installVersion(cache, "a", escaping, "1.0.0", fetcher, "linux-x64");
    expect(refused).toMatchObject({ ok: false, file: "../../escaped.js" });
    expect(existsSync(join(cache, "bundles"))).toBe(false);
  });

  it("refuses an id or a platform key that would climb out of the cache", async () => {
    expect((await installVersion(cache, "../a", plugin, "1.0.0", fetcher, "linux-x64")).ok).toBe(false);
    expect((await installVersion(cache, "liba", linuxOnlyLibrary, "2.0.0", fetcher, "../x")).ok).toBe(false);
    expect(existsSync(join(cache, "bundles"))).toBe(false);
  });

  it("refuses a mismatched file naming the item, the file and the expected hash", async () => {
    const lying: Fetcher = { fetch: async () => new Uint8Array(Buffer.from("x".repeat(56))) };
    const refused = await installVersion(cache, "a", plugin, "1.0.0", lying, "linux-x64");
    expect(refused).toMatchObject({ ok: false, id: "a", version: "1.0.0", file: "plugin.json" });
    expect(refused.ok === false && refused.detail).toContain(plugin.versions["1.0.0"]?.files?.["plugin.json"]?.sha256);
  });
});
