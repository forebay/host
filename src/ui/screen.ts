import type { UiService } from "../runtime/types.js";
import type { RunningHost } from "../start.js";
import { checkedAnswer } from "./answer-checks.js";
import { bindingTarget } from "./binding-target.js";
import { callBinding } from "./bindings.js";

type PlanArgument = Parameters<UiService["plan"]>[0];
type PlannedCall = NonNullable<ReturnType<UiService["plan"]>["calls"]>[number];
type CallAnswer = NonNullable<PlanArgument["answers"]>[number];

export type ScreenRequest = PlanArgument["screen"];
export type HeadlessScreen = ReturnType<UiService["render"]>;
export type HeadlessNode = HeadlessScreen["nodes"][number];
export type Navigation = ReturnType<UiService["navigation"]>;

function descriptionsOf(running: RunningHost): PlanArgument["descriptions"] {
  return running.loaded.deployed.map((deployed) => deployed.manifest as unknown as PlanArgument["descriptions"][number]);
}

async function answerOf(running: RunningHost, call: PlannedCall): Promise<CallAnswer> {
  const asked = { plugin: call.plugin, binding: call.binding, arguments: call.arguments };
  const target = bindingTarget(running, call.plugin, call.binding.service);
  if (target.state === "unavailable") return { ...asked, unavailable: true };
  if (target.state === "refused") return { ...asked, error: { detail: target.error.detail, fix: target.error.fix } };
  const answered = await callBinding(running, call.plugin, { service: call.binding.service, method: call.binding.method, argument: call.arguments });
  if (!answered.ok) return { ...asked, error: { detail: answered.error.detail, fix: answered.error.fix } };
  return { ...asked, answer: answered.value, checked: checkedAnswer(call.checks, answered.value) };
}

/**
 * Renders the screen a navigation entry opens to plain data: `ui.plan` names the bindings still to
 * answer, each is called through the engine and its answer checked there, and `ui.render` draws
 * the screen once nothing is left to call.
 */
export async function renderScreen(running: RunningHost, screen: ScreenRequest): Promise<HeadlessScreen> {
  const descriptions = descriptionsOf(running);
  const answers: CallAnswer[] = [];
  for (;;) {
    const plan = running.runtime.ui.plan({ descriptions, screen, answers });
    if (plan.done === true || plan.calls === undefined || plan.calls.length === 0) break;
    answers.push(...(await Promise.all(plan.calls.map((call) => answerOf(running, call)))));
  }
  return running.runtime.ui.render({ descriptions, screen, answers });
}

/** Every deployed plugin's views, settings screen and actions in the order every host lists them. */
export function navigationOf(running: RunningHost): Navigation {
  const ui = running.settings.all().ui;
  return running.runtime.ui.navigation({ descriptions: descriptionsOf(running), ui: typeof ui === "object" && ui !== null && !Array.isArray(ui) ? (ui as Record<string, unknown>) : {} });
}
