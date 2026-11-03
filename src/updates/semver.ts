const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const NUMERIC = /^\d+$/;

interface ParsedVersion {
  core: [number, number, number];
  prerelease: string[];
}

function parse(version: string): ParsedVersion | undefined {
  const match = SEMVER.exec(version);
  if (match === null) return undefined;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] === undefined ? [] : match[4].split(".") };
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumeric = NUMERIC.test(left);
  const rightNumeric = NUMERIC.test(right);
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparePrereleases(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return right.length - left.length;
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const order = compareIdentifiers(left[index] as string, right[index] as string);
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

function compareParsed(left: ParsedVersion, right: ParsedVersion): number {
  for (let index = 0; index < 3; index++) {
    const order = left.core[index]! - right.core[index]!;
    if (order !== 0) return order;
  }
  return comparePrereleases(left.prerelease, right.prerelease);
}

/** Semver precedence; a name that is not a version sorts below every version, and among such names by text. */
export function compareVersions(left: string, right: string): number {
  const parsedLeft = parse(left);
  const parsedRight = parse(right);
  if (parsedLeft !== undefined && parsedRight !== undefined) return compareParsed(parsedLeft, parsedRight);
  if (parsedLeft !== parsedRight) return parsedLeft === undefined ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function newestVersion(versions: readonly string[]): string | undefined {
  return [...versions].sort(compareVersions).at(-1);
}
