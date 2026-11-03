/**
 * @implNote A catalog is untrusted input: a resolved file url must stay within the kind of source
 * that served the index (https for https, the index's own directory for file), so a hostile index
 * cannot make the host fetch from another scheme, a UNC share or a sibling directory.
 */
export function resolveWithinOrigin(url: string, origin: string): string | undefined {
  const base = parseUrl(origin);
  const resolved = parseUrl(url, origin);
  if (base === undefined || resolved === undefined || base.protocol !== resolved.protocol) return undefined;
  if (base.protocol === "https:") return resolved.href;
  if (base.protocol === "file:" && isInsideIndexDirectory(resolved, base)) return resolved.href;
  return undefined;
}

function parseUrl(url: string, base?: string): URL | undefined {
  try {
    return new URL(url, base);
  } catch {
    return undefined;
  }
}

function isInsideIndexDirectory(resolved: URL, index: URL): boolean {
  if (resolved.hostname !== "" || index.hostname !== "") return false;
  const directory = index.pathname.slice(0, index.pathname.lastIndexOf("/") + 1);
  return resolved.pathname.startsWith(directory);
}
