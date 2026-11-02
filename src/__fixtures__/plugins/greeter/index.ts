import type { Plugin } from "@weivel/typescript";

const greeter: Plugin = {
  activate(context) {
    context.services.register(context.service<{ greet: () => { text: string } }>("demo:greeting"), { greet: () => ({ text: "from greeter" }) });
  },
  deactivate() {},
};

export default greeter;
