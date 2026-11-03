import type { Plugin } from "@weivel/typescript";

const broken: Plugin = {
  activate(context) {
    context.services.register(context.service<object>("broken-install-method:install-method"), {
      detect: () => ({ version: "1.0.0" }),
      install: () => ({ ok: false, detail: "no fix given" }),
      update: () => {
        throw new Error("update blew up");
      },
      remove: () => ({ ok: "yes" }),
    });
  },
  deactivate() {},
};

export default broken;
