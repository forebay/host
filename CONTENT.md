## What this is

The TypeScript layer over the `runtime` C library's services. Everything a host in any language needs,
the catalog, the cache, updates, installs, holders and the screens' logic, is a `json` function of
`runtime`; this package keeps only what is bound to TypeScript:

- `startHost`, which wires `ctx` into the weivel engine and starts the plugin bundles it is given;
- `callBinding`, `runAction` and `renderScreen`, which answer `ui.plan`'s calls through the engine and
  check each answer there before `ui.render` draws the screen;
- the `javascript-host` bundle (`bundleJavascriptHost`), which a launcher starts as
  `<runtime executable> host.js <host id>` and OpenCode's entry imports for `runSessionHost`: it starts
  the plugins `updates.apply` answers for one registered host, runs `updates.check` on its interval and
  `processes.prune` every 5 seconds;
- the bundlers `bundlePlugin`, `bundleLoader` and `bundleKoffiLibrary`, whose output
  `forebay-host catalog build` reads.

```ts
const runtime = openRuntime(siblingRuntime(root));
runtime.places.resolve({ home, environment });
runtime.close();
```

A failure answer from the library throws, as the weivel host's `call` does.

## Building

`siblings/` holds the pinned `weivel/model`, `weivel/typescript` and `spisor/library` checkouts, as
the CI workflow lays them out. Build the library in Release, build `siblings/typescript`, then run
`npm test`. `src/runtime/types.ts` is generated from the declaration of the services the layer calls;
`npm run generate:runtime-types` regenerates it once the weivel generator reads every schema form
`runtime/library.json` uses.
