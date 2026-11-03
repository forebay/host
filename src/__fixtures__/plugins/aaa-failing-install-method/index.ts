import type { Plugin } from "@weivel/typescript";

const failing: Plugin = {
  activate() {
    throw new Error("cannot start");
  },
  deactivate() {},
};

export default failing;
