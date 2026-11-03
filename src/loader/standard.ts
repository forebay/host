import { isRecord } from "../plugins/is-record.js";

export type PackageMapping = string | { name: string; options?: Record<string, unknown>; [member: string]: unknown };

export interface LoaderApplication {
  id: string;
  label: string;
  binary: string;
  home: { envOverride?: string; nativeEnv?: string; candidates: string[] };
  packages: Record<string, PackageMapping>;
}

/**
 * What a loader declares about the application it loads into, the PATH commands it asks for and
 * the background hosts it keeps running.
 *
 * @remarks `packages` is the manifest shape of the host registry design (5.2), so
 * `runtime.install.packages` merges the user's `packages.json` over it unchanged.
 */
export interface LoaderStandard {
  application: LoaderApplication;
  pathCommands: { requested: string[]; minimum: 0 | 1 };
  background: string[];
}

export interface LoaderStandardIssue {
  path: string;
  detail: string;
  fix: string;
}

const HOME_PREFIX = "~/";
const PORTABLE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PORTABLE_NAME_FIX = "name it as one portable file name: a letter or digit, then letters, digits, \".\", \"_\" or \"-\", at most 64 characters";
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\/]|[\/])/;

function issue(path: string, detail: string, fix: string): LoaderStandardIssue[] {
  return [{ path, detail, fix }];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isHomeCandidate(candidate: string): boolean {
  return candidate.startsWith(HOME_PREFIX) || ABSOLUTE_PATH.test(candidate);
}

function isPortableName(value: unknown): value is string {
  return typeof value === "string" && PORTABLE_NAME.test(value);
}

function checkText(application: Record<string, unknown>, member: string): LoaderStandardIssue[] {
  if (isNonEmptyString(application[member])) return [];
  return issue(`/application/${member}`, `the application has no ${member}`, `name the application's ${member} as a non-empty string`);
}

function checkBinary(binary: unknown): LoaderStandardIssue[] {
  if (isPortableName(binary)) return [];
  return issue("/application/binary", `the binary ${JSON.stringify(binary)} is not a portable file name`, `${PORTABLE_NAME_FIX}; a path is not a binary name`);
}

function checkOptionalName(home: Record<string, unknown>, member: string): LoaderStandardIssue[] {
  if (home[member] === undefined || isNonEmptyString(home[member])) return [];
  return issue(`/application/home/${member}`, `${member} is not an environment variable name`, `name the variable as a non-empty string, or leave ${member} out`);
}

function checkCandidates(candidates: unknown): LoaderStandardIssue[] {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return issue("/application/home/candidates", "the home has no candidate directories", 'list at least one candidate, for example "~/.claude"');
  }
  return candidates.flatMap((candidate, index) =>
    typeof candidate === "string" && isHomeCandidate(candidate)
      ? []
      : issue(`/application/home/candidates/${index}`, `the candidate ${JSON.stringify(candidate)} is neither rooted at ~/ nor absolute`, 'root the candidate at "~/" or write an absolute path'),
  );
}

function checkHome(home: unknown): LoaderStandardIssue[] {
  if (!isRecord(home)) return issue("/application/home", "the application has no home", "give the application a home with a candidates list");
  return [...checkOptionalName(home, "envOverride"), ...checkOptionalName(home, "nativeEnv"), ...checkCandidates(home.candidates)];
}

function isPackageMapping(value: unknown): boolean {
  if (typeof value === "string") return true;
  return isRecord(value) && typeof value.name === "string" && (value.options === undefined || isRecord(value.options));
}

function checkPackages(packages: unknown): LoaderStandardIssue[] {
  if (!isRecord(packages)) return issue("/application/packages", "the application has no packages", "map each install method id to a package name");
  return Object.entries(packages).flatMap(([method, mapping]) => [
    ...(isPortableName(method) ? [] : issue(`/application/packages/${method}`, `${JSON.stringify(method)} is not an install method id`, `${PORTABLE_NAME_FIX}, for example "npm"`)),
    ...(isPackageMapping(mapping)
      ? []
      : issue(`/application/packages/${method}`, `the package under ${method} is neither a name nor an object with a name and optional options object`, 'write the package as "name" or {"name": "name", "options": {}}')),
  ]);
}

function checkApplication(application: unknown): LoaderStandardIssue[] {
  if (!isRecord(application)) return issue("/application", "the standard has no application", "describe the application with an id, label, binary, home and packages");
  return [...checkText(application, "id"), ...checkText(application, "label"), ...checkBinary(application.binary), ...checkHome(application.home), ...checkPackages(application.packages)];
}

function checkPathCommands(pathCommands: unknown): LoaderStandardIssue[] {
  const fix = 'declare the PATH commands as {"requested": ["name"], "minimum": 0 or 1}';
  if (!isRecord(pathCommands)) return issue("/pathCommands", "the standard has no pathCommands", fix);
  const requestedValid = Array.isArray(pathCommands.requested) && pathCommands.requested.every(isPortableName) && new Set(pathCommands.requested).size === pathCommands.requested.length;
  const minimumValid = pathCommands.minimum === 0 || pathCommands.minimum === 1;
  return [
    ...(requestedValid ? [] : issue("/pathCommands/requested", "requested is not a list of unique portable command names", `${fix}; ${PORTABLE_NAME_FIX}`)),
    ...(minimumValid ? [] : issue("/pathCommands/minimum", "minimum is neither 0 nor 1", 'set "minimum" to 0 when the host works without a command on PATH, or 1 when it needs one')),
  ];
}

function checkBackground(background: unknown): LoaderStandardIssue[] {
  if (Array.isArray(background) && background.every(isNonEmptyString)) return [];
  return issue("/background", "background is not a list of host ids", "list the ids of the hosts to keep running, or an empty list");
}

/** An empty list means `value` is a valid {@link LoaderStandard}. */
export function checkLoaderStandard(value: unknown): LoaderStandardIssue[] {
  if (!isRecord(value)) return issue("", "the standard is not an object", "give the standard an application, pathCommands and background");
  return [...checkApplication(value.application), ...checkPathCommands(value.pathCommands), ...checkBackground(value.background)];
}
