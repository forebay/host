import type { Plugin } from "@weivel/typescript";

const greeter: Plugin = {
  activate(context) {
    context.services.register(context.service<() => string>("demo:greeting"), () => "hello from a");
  },
  deactivate() {},
};

export default greeter;
