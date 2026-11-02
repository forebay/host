import type { Plugin } from "@weivel/typescript";

const greeter: Plugin = {
  activate(context) {
    context.services.register(context.service<() => string>("demo:greeting"), () => "hello from z");
  },
  deactivate() {},
};

export default greeter;
