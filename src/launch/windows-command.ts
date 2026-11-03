import { extname } from "node:path";
import { argument, command } from "cross-spawn/lib/util/escape.js";

const DIRECT_EXTENSIONS = new Set([".exe", ".com"]);

/** How to start a program: the executable and its arguments, already quoted when the shell parses them. */
export interface Invocation {
  command: string;
  arguments: string[];
}

/** Whether `binary` is a batch file or script that only the command shell can start on Windows. */
export function needsCommandShell(binary: string): boolean {
  return !DIRECT_EXTENSIONS.has(extname(binary).toLowerCase());
}

/**
 * Starts `binary` through `cmd.exe /d /s /c`, which a `.cmd` or `.bat` file (an npm shim among them)
 * needs, since Windows cannot start one directly.
 *
 * @implNote Every argument is escaped twice by cross-spawn's rules, because the shell parses the
 * line once and a batch file passing `%*` on parses it again; escaped once, an argument holding a
 * quote and `&` runs a command of its own (CVE-2024-27980). The arguments must be passed verbatim,
 * since Node's own quoting would wrap this a second time.
 */
export function commandShellInvocation(binary: string, givenArguments: readonly string[], commandShell: string): Invocation {
  const line = [command(binary), ...givenArguments.map((given) => argument(given, true))].join(" ");
  return { command: commandShell, arguments: ["/d", "/s", "/c", `"${line}"`] };
}
