import type { Plugin } from "@weivel/typescript";

const SERIES = [{ label: "load", points: [1, 2, 3] }];

const status = {
  rows: () => ({ items: [{ id: "x", state: "detected" }] }),
  wrongShape: () => ({ items: "oops" }),
  bare: () => "oops",
  greeting: () => ({ text: "hello" }),
  fails: () => {
    throw new Error("the status file is unreadable");
  },
  hangs: () => new Promise(() => {}),
  series: () => ({ series: SERIES }),
  seriesAndMeasure: () => ({ series: SERIES, value: 3, maximum: 10 }),
  echo: (argument: unknown) => argument,
};

const viewer: Plugin = {
  activate(context) {
    context.services.register(context.service<typeof status>("viewer:status"), status);
  },
  deactivate() {},
};

export default viewer;
