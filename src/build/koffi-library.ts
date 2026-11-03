import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { KOFFI_ID } from "../install/host-libraries.js";
import { BuildRefusal } from "./build-refusal.js";
import { libraryDirectoryOutput } from "./built-directory.js";
import type { BundleOutput } from "./bundle-plugin.js";

const NATIVE_MODULE = "koffi.node";
const PACKAGE_FILES = ["index.js", "package.json", "LICENSE.txt"];

/**
 * The folders under `build/koffi/` koffi looks in for this platform's native module.
 *
 * @implNote Measured in koffi 2.16.3's `index.js`: it requires `./build/koffi/<platform>_<arch>/koffi.node`
 * relative to itself, and on Linux falls back to `musl_<arch>`, so both ship for a `linux-*` key.
 */
function nativeFolders(platformKey: string): string[] {
  const [os, arch] = platformKey.split("-") as [string, string];
  const folders = [`${os}_${arch}`];
  if (os === "linux") folders.push(`musl_${arch}`);
  return folders;
}

function nativeModules(platformKey: string): string[] {
  return nativeFolders(platformKey).map((folder) => `build/koffi/${folder}/${NATIVE_MODULE}`);
}

function copyInto(packageDirectory: string, outDirectory: string, key: string): void {
  const destination = join(outDirectory, ...key.split("/"));
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(packageDirectory, ...key.split("/")), destination);
}

function present(packageDirectory: string, keys: string[]): string[] {
  return keys.filter((key) => existsSync(join(packageDirectory, ...key.split("/"))));
}

/**
 * Lays out the installed `koffi` package at `packageDirectory` as the catalog library `koffi` for
 * one platform: its self-contained `index.js`, its `package.json` and the native module koffi
 * requires beside them, so it loads by path from any directory.
 *
 * @remarks `outDirectory` must be empty or absent, since every file in it is listed.
 */
export function koffiLibraryOutput(packageDirectory: string, platformKey: string, outDirectory: string): BundleOutput {
  const natives = present(packageDirectory, nativeModules(platformKey));
  if (natives.length === 0) {
    throw new BuildRefusal(`${packageDirectory} carries no koffi native module for ${platformKey}`, "install a koffi release that ships a prebuilt module for this platform");
  }
  for (const key of [...present(packageDirectory, PACKAGE_FILES), ...natives]) copyInto(packageDirectory, outDirectory, key);
  return libraryDirectoryOutput(KOFFI_ID, outDirectory);
}
