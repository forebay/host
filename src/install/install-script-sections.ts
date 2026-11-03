export type InstallScriptKind = "sh" | "ps1";

/** A block of an install script that a render script writes from a source of truth. */
export interface RenderedSection {
  begin: string;
  end: string;
}

export function shQuoted(value: string): string {
  return `'${value.split("'").join("'\''")}'`;
}

export function ps1Quoted(value: string): string {
  return `'${value.split("'").join("''")}'`;
}

/**
 * `script` with the lines from the section's begin marker to its end marker replaced by `lines`.
 *
 * @remarks Throws when either marker is missing, since rendering would otherwise drop the section.
 */
export function withRenderedSection(script: string, kind: InstallScriptKind, section: RenderedSection, lines: readonly string[]): string {
  const all = script.split("\n");
  const begin = all.indexOf(section.begin);
  const end = all.indexOf(section.end);
  if (begin < 0 || end < begin) throw new Error(`the ${kind} install script has no "${section.begin}" line followed by "${section.end}"`);
  return [...all.slice(0, begin), section.begin, ...lines, section.end, ...all.slice(end + 1)].join("\n");
}
