import type { Plugin } from "@weivel/typescript";

const dormant: Plugin = {
  activate(context) {
    context.services.register(context.service<{ read: () => { text: string } }>("dormant:status"), { read: () => ({ text: "awake" }) });
  },
  deactivate() {},
};

export default dormant;
