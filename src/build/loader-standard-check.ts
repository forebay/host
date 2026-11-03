import { checkLoaderStandard } from "../loader/standard.js";
import { BuildRefusal } from "./build-refusal.js";

export function requireLoaderStandard(value: unknown, source: string): void {
  const issues = checkLoaderStandard(value);
  if (issues.length === 0) return;
  const [first] = issues;
  throw new BuildRefusal(`${source} has an invalid loader standard at ${first?.path}: ${first?.detail}`, first?.fix ?? "correct the standard");
}
