export type RuntimeArchive = "zip" | "tar.gz";

export interface RuntimeBuild {
  url: string;
  sha256: string;
  archive: RuntimeArchive;
}

export interface PinnedRuntime {
  name: "node" | "bun";
  version: string;
  platforms: Record<string, RuntimeBuild>;
}

/**
 * The JavaScript runtime the installer acquires to run the host, per platform.
 *
 * @implNote Node did not win on size or memory. By `scripts/measure-runtime.mjs`, Node's tar.gz is
 * larger than Bun 1.4.4's zip on linux-x64 (62.9 MB to 51.8), darwin-x64 (59.8 to 43.4) and
 * darwin-arm64 (58.3 to 40.3), smaller only on win32-x64 (41.2 to 54.7), and Bun's idle working set
 * on Windows is lower (52.3 MB to 58.5). Spec 5.3 compares size and memory only between runtimes
 * that run every plugin unchanged, and Bun has run just two fixture plugins while the real ones are
 * Node programs, so Node is the only candidate that qualifies; the comparison is re-run with the
 * real plugins under Bun. POSIX takes tar.gz because every system tar reads gzip, while xz and
 * `unzip` are missing from a minimal Linux. Each `sha256` is copied from
 * `https://nodejs.org/dist/v26.13.0/SHASUMS256.txt`, never computed from a download.
 */
export const RUNTIME_PIN: PinnedRuntime = {
  name: "node",
  version: "26.13.0",
  platforms: {
    "win32-x64": {
      url: "https://nodejs.org/dist/v26.13.0/node-v26.13.0-win-x64.zip",
      sha256: "dcc60d59a0746999f99064a01c020445d54d84228c691cdbf25b49ac3b59150a",
      archive: "zip",
    },
    "linux-x64": {
      url: "https://nodejs.org/dist/v26.13.0/node-v26.13.0-linux-x64.tar.gz",
      sha256: "5848553868b402d3fabb5b09270649977780a390f832155721025a08b5104455",
      archive: "tar.gz",
    },
    "darwin-x64": {
      url: "https://nodejs.org/dist/v26.13.0/node-v26.13.0-darwin-x64.tar.gz",
      sha256: "525c9b29bb0263d687de60a4cec0e2a6db876a8eb032369e5795eca71e7c358e",
      archive: "tar.gz",
    },
    "darwin-arm64": {
      url: "https://nodejs.org/dist/v26.13.0/node-v26.13.0-darwin-arm64.tar.gz",
      sha256: "d38bd5e5a2ddce6bbb5ce45e46e208337da4d51fffe611e567fd32073d6439f6",
      archive: "tar.gz",
    },
  },
};

/** The lowest major version of {@link RUNTIME_PIN}'s runtime that the installer uses from the PATH instead of acquiring the pin, matching `engines.node`. */
export const COMPATIBLE_RUNTIME_MAJOR = 20;
