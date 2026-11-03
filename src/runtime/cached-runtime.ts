import { join } from "node:path";
import { currentPlatformKey } from "@weivel/typescript/host";
import type { RuntimeSource } from "./open.js";

const DECLARATION_FILE = "library.json";

/** The runtime's shared library file name on the OS a platform key such as `linux-x64` names. */
export function runtimeBinaryName(platformKey: string): string {
  const os = platformKey.split("-")[0];
  if (os === "win32") return "runtime.dll";
  return os === "darwin" ? "libruntime.dylib" : "libruntime.so";
}

/** The runtime installed as the catalog library `runtime`, at `<cache>/libraries/runtime/<version>/<platform>/`. */
export function cachedRuntime(cache: string, version: string, platformKey: string = currentPlatformKey()): RuntimeSource {
  const directory = join(cache, "libraries", "runtime", version, platformKey);
  return { binaryPath: join(directory, runtimeBinaryName(platformKey)), declarationPath: join(directory, DECLARATION_FILE) };
}
