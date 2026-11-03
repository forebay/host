import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CacheRefusal } from "../cache/cache-refusal.js";
import { sha256Of } from "../cache/sha256.js";
import type { Catalog } from "../catalog/catalog.js";
import { bootLibraries, recordBootLibraries, resolveHostLibraries, verifiedRuntimeSource } from "./host-libraries.js";

const PLATFORM = "linux-x64";

let base: string;
let cache: string;

function installed(id: string, version: string, files: Record<string, string> = {}): string {
  const directory = join(cache, "libraries", id, version, PLATFORM);
  mkdirSync(directory, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(directory, name), text);
  const hashes = Object.fromEntries(Object.entries(files).map(([name, text]) => [name, sha256Of(Buffer.from(text))]));
  writeFileSync(join(directory, ".installed.json"), JSON.stringify({ files: hashes }));
  return directory;
}

function catalogWithLatest(latest: Record<string, string>): Catalog {
  const items: Catalog["items"] = {};
  for (const [id, version] of Object.entries(latest)) items[id] = { kind: "library", latest: version, versions: { [version]: { files: {} } } };
  return { format: 1, items };
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "host-libraries-"));
  cache = join(base, "cache");
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("resolveHostLibraries", () => {
  it("runs the catalog's latest when it is installed, even beside a newer one", () => {
    for (const version of ["0.1.0", "0.2.0"]) installed("runtime", version);
    installed("koffi", "2.0.0");
    expect(resolveHostLibraries(catalogWithLatest({ runtime: "0.1.0", koffi: "2.0.0" }), {}, cache, PLATFORM)).toEqual({ runtime: "0.1.0", koffi: "2.0.0" });
  });

  it("runs the newest installed when the catalog's latest is not installed", () => {
    for (const version of ["0.1.0", "0.2.0"]) installed("runtime", version);
    expect(resolveHostLibraries(catalogWithLatest({ runtime: "0.3.0" }), {}, cache, PLATFORM)).toEqual({ runtime: "0.2.0" });
  });

  it("holds a library to the pin the settings give it", () => {
    for (const version of ["0.1.0", "0.2.0"]) installed("runtime", version);
    const settings = { plugins: { runtime: { pin: "0.1.0" } } };
    expect(resolveHostLibraries(catalogWithLatest({ runtime: "0.2.0" }), settings, cache, PLATFORM)).toEqual({ runtime: "0.1.0" });
  });
});

describe("bootLibraries", () => {
  it("loads what the last resolution recorded, and the newest installed when nothing is recorded", () => {
    for (const version of ["0.1.0", "0.2.0"]) installed("runtime", version);
    installed("koffi", "2.0.0");
    expect(bootLibraries(cache, "forebay-host", PLATFORM)).toEqual({ runtime: "0.2.0", koffi: "2.0.0" });
    recordBootLibraries(cache, "forebay-host", { runtime: "0.1.0", koffi: "2.0.0" });
    expect(bootLibraries(cache, "forebay-host", PLATFORM)).toEqual({ runtime: "0.1.0", koffi: "2.0.0" });
  });

  it("answers undefined when either library is not installed", () => {
    installed("runtime", "0.1.0");
    expect(bootLibraries(cache, "forebay-host", PLATFORM)).toBeUndefined();
  });
});

describe("verifiedRuntimeSource", () => {
  it("names the runtime and koffi it verified", () => {
    const runtime = installed("runtime", "0.1.0", { "libruntime.so": "binary", "library.json": "{}" });
    const koffi = installed("koffi", "2.0.0", { "index.js": "module.exports = {};" });
    expect(verifiedRuntimeSource(cache, { runtime: "0.1.0", koffi: "2.0.0" }, PLATFORM)).toEqual({
      binaryPath: join(runtime, "libruntime.so"),
      declarationPath: join(runtime, "library.json"),
      koffiDirectory: koffi,
    });
  });

  it("refuses a library whose files no longer match their install, naming the file", () => {
    installed("runtime", "0.1.0", { "libruntime.so": "binary", "library.json": "{}" });
    const koffi = installed("koffi", "2.0.0", { "index.js": "module.exports = {};" });
    writeFileSync(join(koffi, "index.js"), "module.exports = { tampered: true };");
    let thrown: unknown;
    try {
      verifiedRuntimeSource(cache, { runtime: "0.1.0", koffi: "2.0.0" }, PLATFORM);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CacheRefusal);
    expect((thrown as CacheRefusal).detail).toContain("index.js");
  });
});
