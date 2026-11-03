import type { Plugin } from "@weivel/typescript";

const twin: Plugin = {
  activate(context) {
    context.services.register(context.service<object>("twin-install-method:install-method"), {
      detect: () => ({ installed: true, version: "9.9.9" }),
      install: () => ({ ok: true }),
      update: () => ({ ok: true }),
      remove: () => ({ ok: true }),
    });
  },
  deactivate() {},
};

export default twin;
