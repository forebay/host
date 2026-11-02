import type { Plugin } from "@weivel/typescript";

const announcer: Plugin = {
  activate(context) {
    const voice = {
      say: () => {
        context.log.error("spoken");
        return { text: "said" };
      },
    };
    context.services.register(context.service<typeof voice>("announcer:voice"), voice);
  },
  deactivate() {},
};

export default announcer;
