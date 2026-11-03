import { extname } from "node:path";

const SHELL_CHARACTERS = /([()\][%!^"`<>&|;, *?])/g;
const DIRECT_EXTENSIONS = new Set([".exe", ".com"]);

/** How to start a program: the executable and its arguments, already quoted when the shell parses them. */
export interface Invocation {
  command: string;
  arguments: string[];
}

function escapeShellCharacters(text: string): string {
  return text.replace(SHELL_CHARACTERS, "^$1");
}

/** @implNote Quoted the way the C runtime splits a command line, then every shell character escaped, so `cmd.exe` hands the batch file each argument as given. */
function escapeArgument(argument: string): string {
  const quoted = `"${argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  return escapeShellCharacters(quoted);
}

/** Whether `binary` is a batch file or script that only the command shell can start on Windows. */
export function needsCommandShell(binary: string): boolean {
  return !DIRECT_EXTENSIONS.has(extname(binary).toLowerCase());
}

/**
 * Starts `binary` through `cmd.exe /d /s /c`, which a `.cmd` or `.bat` file (an npm shim among them)
 * needs, since Windows cannot start one directly.
 *
 * @implNote The arguments must be passed verbatim, because the quoting here is for the command
 * shell and Node's own quoting would wrap it a second time.
 */
export function commandShellInvocation(binary: string, givenArguments: readonly string[], commandShell: string): Invocation {
  const line = [escapeShellCharacters(binary), ...givenArguments.map(escapeArgument)].join(" ");
  return { command: commandShell, arguments: ["/d", "/s", "/c", `"${line}"`] };
}
