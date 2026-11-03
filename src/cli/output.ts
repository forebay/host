/** Where a command prints: `out` for what it did, `error` for a refusal or the usage. */
export interface CommandLineOutput {
  out(line: string): void;
  error(line: string): void;
}

export const PROCESS_OUTPUT: CommandLineOutput = {
  out: (line) => process.stdout.write(`${line}\n`),
  error: (line) => process.stderr.write(`${line}\n`),
};
