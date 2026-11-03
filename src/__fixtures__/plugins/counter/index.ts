import { appendFileSync } from "node:fs";
import type { Plugin } from "@weivel/typescript";

export const ACTIVATIONS_VARIABLE = "SPISOR_FIXTURE_ACTIVATIONS";

/** Appends one line to the file `SPISOR_FIXTURE_ACTIVATIONS` names each time it is activated, so a test counts activations in another process. */
const counter: Plugin = {
  activate(context) {
    const file = process.env[ACTIVATIONS_VARIABLE];
    if (file !== undefined) appendFileSync(file, `${process.pid}\n`);
    context.services.register(context.service<{ count: () => number }>("counter:count"), { count: () => 1 });
  },
  deactivate() {},
};

export default counter;
