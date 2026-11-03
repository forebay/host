import { createRequire } from "node:module";
import { join, resolve } from "node:path";

type Koffi = Record<string | symbol, unknown>;

let directory: string | undefined;
let loaded: Koffi | undefined;

/**
 * Tells the stand-in which cached koffi to load, `<cache>/libraries/koffi/<version>/<platform>/`.
 *
 * @implNote A native module cannot be unloaded, so once one is loaded a different directory is
 * refused rather than ignored: the main thread and its worker are always given the same one.
 */
export function useKoffiFrom(koffiDirectory: string): void {
  const given = resolve(koffiDirectory);
  if (loaded !== undefined && directory !== given) {
    throw new Error(`koffi from ${directory} is already loaded, so koffi from ${given} cannot be; start the host again to load it`);
  }
  directory = given;
}

function koffi(): Koffi {
  if (directory === undefined) {
    throw new Error("the host has not been told where koffi is; open the runtime through a source that names its koffi directory");
  }
  loaded ??= createRequire(import.meta.url)(join(directory, "index.js")) as Koffi;
  return loaded;
}

/**
 * Stands in for the `koffi` package in the host bundle, loading the koffi {@link useKoffiFrom} names
 * the first time any member is read.
 *
 * @implNote Lazy, because `install` runs this bundle before koffi is in the cache and fetches it
 * first; nothing reads a member until the runtime is opened.
 */
const cachedKoffi: Koffi = new Proxy({} as Koffi, { get: (_, member) => koffi()[member] });

export default cachedKoffi;
