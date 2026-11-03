import { join } from "node:path";
import { currentPlatformKey } from "@weivel/typescript/host";
import type { RuntimeSource } from "./open.js";

const DECLARATION_FILE = "library.json";

/** The runtime and koffi versions a host loads from the cache. */
export interface HostLibraries {
  runtime: string;
  koffi: string;
}

/** The runtime's shared library file name on the OS a platform key such as `linux-x64` names. */
export function runtimeBinaryName(platformKey: string): string {
  const os = platformKey.split("-")[0];
  if (os === "win32") return "runtime.dll";
  return os === "darwin" ? "libruntime.dylib" : "libruntime.so";
}

/** Where library `id` at `version` is installed for `platformKey`. */
export function libraryDirectory(cache: string, id: string, version: string, platformKey: string): string {
  return join(cache, "libraries", id, version, platformKey);
}

/** The cached runtime, opened through the cached koffi, at the versions `libraries` names. */
export function cachedRuntime(cache: string, libraries: HostLibraries, platformKey: string = currentPlatformKey()): RuntimeSource {
  const directory = libraryDirectory(cache, "runtime", libraries.runtime, platformKey);
  return {
    binaryPath: join(directory, runtimeBinaryName(platformKey)),
    declarationPath: join(directory, DECLARATION_FILE),
    koffiDirectory: libraryDirectory(cache, "koffi", libraries.koffi, platformKey),
  };
}
