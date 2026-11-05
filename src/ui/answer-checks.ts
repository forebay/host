import type { UiComponent } from "@weivel/typescript";
import { checkUiData } from "@weivel/typescript/host";

/** One ui-data check `ui.plan` names for a call's answer. */
export type AnswerCheck = {
  against: string;
  members?: string[];
};

export type CheckIssue = {
  message: string;
  fix: string;
  path?: string;
};

export type CheckedAnswer = AnswerCheck & { issues: CheckIssue[] };

/**
 * @implNote An array counts as an object here, so an array answer to a chart is checked as an
 * object whose members are all missing.
 */
function picked(answer: unknown, members: readonly string[]): unknown {
  if (typeof answer !== "object" || answer === null) return answer;
  const record = answer as Record<string, unknown>;
  return Object.fromEntries(members.map((member) => [member, record[member]]));
}

function issuesOf(check: AnswerCheck, answer: unknown): CheckIssue[] {
  const subject = check.members === undefined ? answer : picked(answer, check.members);
  return (checkUiData(check.against as UiComponent, subject) ?? []).map(({ message, fix, path }) => (path === undefined ? { message, fix } : { message, fix, path }));
}

/** Runs each check against `answer` through the engine, one result per check; a definition the engine has no schema for answers no issues. */
export function checkedAnswer(checks: readonly AnswerCheck[], answer: unknown): CheckedAnswer[] {
  return checks.map((check) => ({ ...check, issues: issuesOf(check, answer) }));
}
