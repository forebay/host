import type { Plugin } from "@weivel/typescript";

const reader: Plugin = {
  activate(context) {
    const greeting = context.services.get(context.service<() => string>("demo:greeting"));
    if (greeting === undefined) throw new Error("b started before anything provided demo:greeting");
  },
  deactivate() {},
};

export default reader;
