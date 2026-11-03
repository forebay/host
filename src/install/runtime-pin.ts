export type RuntimeArchive = "zip" | "tar.gz" | "tar.xz";

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
 * @implNote Node over Bun by `scripts/measure-runtime.mjs`: both ran the installed host and its
 * plugins unchanged, Node's download is 24 to 34 percent smaller on every platform and Bun's idle
 * working set about 10 percent lower, and the larger margin decides. Each `sha256` is copied from
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
      url: "https://nodejs.org/dist/v26.13.0/node-v26.13.0-linux-x64.tar.xz",
      sha256: "d28a96af6c38596f6d9d97c0ee531c13d238d757742387d1928de822d959e997",
      archive: "tar.xz",
    },
    "darwin-x64": {
      url: "https://nodejs.org/dist/v26.13.0/node-v26.13.0-darwin-x64.tar.xz",
      sha256: "8bd636bc981a92e1ab930c02340eece2076eb1aaf94d14e421cdeeddc1292298",
      archive: "tar.xz",
    },
    "darwin-arm64": {
      url: "https://nodejs.org/dist/v26.13.0/node-v26.13.0-darwin-arm64.tar.xz",
      sha256: "6f5b3187d9df9fc007e881167905bc7d69ad26450ddc377c83d63256a2495b6e",
      archive: "tar.xz",
    },
  },
};
