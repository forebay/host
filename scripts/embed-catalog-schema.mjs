import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import standaloneCode from "ajv/dist/standalone/index.js";

const require = createRequire(import.meta.url);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const HELPER_SELF_DESCRIPTION = /\.code = '.*';/g;

function requiresAnything(source) {
  return /\brequire\(/.test(source.replace(HELPER_SELF_DESCRIPTION, ""));
}

/**
 * ajv's ESM output still calls `require` for its runtime helpers, which no ESM host provides, so
 * each helper's CommonJS source is inlined as a closure. A helper that requires anything further
 * cannot be inlined that way, and stops the build rather than ship a module that fails to load.
 */
function inlineRuntimeHelpers(source) {
  return source.replace(/require\("([^"]+)"\)/g, (_, specifier) => {
    const helper = readFileSync(require.resolve(specifier), "utf8").replace(/^\/\/# sourceMappingURL=.*$/m, "");
    if (requiresAnything(helper)) {
      throw new Error(`ajv runtime helper ${specifier} requires further modules and cannot be inlined`);
    }
    return `((exports) => {${helper}\nreturn exports;})({})`;
  });
}

const CATALOG_VALIDATOR_TYPE =
  "export type CatalogValidator = ((data: unknown) => boolean) & { errors?: Array<{ instancePath: string; keyword: string; message?: string; params: Record<string, unknown>; propertyName?: string }> | null };";

function validatorModule(schema) {
  const ajv = new Ajv({ strict: true, strictRequired: false, allErrors: false, code: { source: true, esm: true } });
  const standalone = inlineRuntimeHelpers(standaloneCode(ajv, ajv.compile(schema))).replace(/^"use strict";/, "");
  const exported = /export const validate = (\w+);export default \1;/.exec(standalone);
  if (!exported) throw new Error("ajv's standalone output no longer exports its validator in the expected shape");
  const body = standalone.replace(exported[0], "");
  if (/new Function|\beval\(/.test(body) || requiresAnything(body)) {
    throw new Error("the precompiled catalog validator still generates or requires code at run time");
  }
  return [
    "// @ts-nocheck",
    CATALOG_VALIDATOR_TYPE,
    body,
    `export const CATALOG_SCHEMA_ID: string = ${JSON.stringify(schema.$id)};`,
    `export const validateCatalogIndex: CatalogValidator = ${exported[1]};`,
    "",
  ].join("\n");
}

const schema = JSON.parse(readFileSync(join(repositoryRoot, "catalog.schema.json"), "utf8"));
const target = join(repositoryRoot, "src", "catalog", "schema.generated.ts");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, validatorModule(schema));
