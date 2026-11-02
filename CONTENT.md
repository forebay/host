## What this is

The shared host every spisor application is built from. It opens the `runtime` C library through the
weivel TypeScript host and hands back a typed `Runtime`, one method per library function.

```ts
const runtime = openRuntime(siblingRuntime(root));
runtime.places.resolve({ home, environment });
runtime.close();
```

A failure answer from the library throws, as the weivel host's `call` does.

## Building

`siblings/` holds the pinned `weivel/model`, `weivel/typescript` and `spisor/library` checkouts, as
the CI workflow lays them out. Build the library in Release, build `siblings/typescript`, then run
`npm test`. `npm run generate:runtime-types` rewrites `src/runtime/types.ts` from the library's
declaration.
