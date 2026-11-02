import type { Plugin } from "@weivel/typescript";

const rival: Plugin = {
  activate(context) {
    context.services.register(context.service<{ greet: () => { text: string } }>("demo:greeting"), { greet: () => ({ text: "from rival" }) });
  },
  deactivate() {},
};

export default rival;
