import { isRecord } from "../plugins/is-record.js";
import { runAction } from "../ui/bindings.js";
import { startJavascriptHost } from "./start-javascript-host.js";

export const ACTION_MODE = "action";

/** One plugin action to run on a host's plugins, as `forebay-host action` passes it after the host id. */
export interface ActionRequest {
  plugin: string;
  action: string;
  input: Record<string, unknown>;
}

export interface ActionOptions {
  hostId: string;
  bundleFile: string;
  environment: Record<string, string>;
  writeError(text: string): void;
  writeOutput(text: string): void;
}

/** The action `arguments_` names, `<plugin> <action> <input-json>`, or undefined when they are not that. */
export function actionRequestOf(arguments_: readonly string[]): ActionRequest | undefined {
  const [plugin, action, inputJson] = arguments_;
  if (arguments_.length !== 3 || plugin === undefined || action === undefined || inputJson === undefined) return undefined;
  let input: unknown;
  try {
    input = JSON.parse(inputJson);
  } catch {
    return undefined;
  }
  return isRecord(input) ? { plugin, action, input } : undefined;
}

/**
 * Starts the host's plugins without serving its proxy, runs one action, prints its answer as JSON
 * and stops them again, answering the exit code: 0 for an answer, 1 for a refusal.
 */
export async function runActionMode(request: ActionRequest, options: ActionOptions): Promise<number> {
  const host = await startJavascriptHost({ hostId: options.hostId, bundleFile: options.bundleFile, environment: options.environment, held: false, session: false, writeError: options.writeError });
  try {
    const answer = await runAction(host.running, request.plugin, request.action, {}, request.input);
    if (answer.ok) {
      options.writeOutput(`${JSON.stringify(answer.value ?? null)}\n`);
      return 0;
    }
    options.writeError(`spisor could not run ${request.plugin}'s ${request.action}: ${answer.error.detail}\nfix: ${answer.error.fix}\n`);
    return 1;
  } finally {
    await host.stop();
  }
}
