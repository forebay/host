import { execFileSync } from "node:child_process";
import { basename } from "node:path";

/** The entries of the real user PATH on Windows (HKCU\Environment), empty elsewhere. */
export function userPathEntries(): string[] {
  if (process.platform !== "win32") return [];
  const output = execFileSync("reg", ["query", "HKCU\\Environment", "/v", "Path"], { encoding: "utf8" });
  const line = output.split(/\r?\n/).find((candidate) => /^\s+Path\s+REG_/i.test(candidate)) ?? "";
  return (line.split(/REG_\w+/i)[1] ?? "").trim().split(";").filter((entry) => entry !== "");
}

/** Entries of the real user PATH that lie under a test's temp base, matched by its directory name so short 8.3 spellings count. */
export function userPathEntriesUnder(base: string): string[] {
  const marker = basename(base).toLowerCase();
  return userPathEntries().filter((entry) => entry.toLowerCase().includes(marker));
}
