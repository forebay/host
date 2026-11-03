/** Two file keys that would name one file on a file system that ignores case, as Windows and macOS do by default. */
export type FoldedPair = [first: string, second: string];

function foldedKey(key: string): string {
  return key.normalize("NFC").toLowerCase();
}

/** The first two of `keys` that fold to the same name, or undefined when every key names its own file. */
export function foldedDuplicate(keys: Iterable<string>): FoldedPair | undefined {
  const seen = new Map<string, string>();
  for (const key of keys) {
    const earlier = seen.get(foldedKey(key));
    if (earlier !== undefined) return [earlier, key];
    seen.set(foldedKey(key), key);
  }
  return undefined;
}
