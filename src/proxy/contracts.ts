import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv } from "ajv";
import type { ValidateFunction } from "ajv";

const SCHEMA_FILES = ["ir.schema.json", "front-door.schema.json", "provider.schema.json"];

/** The definitions a plugin answer is checked against, by the name `forebay/library`'s contracts give them. */
export type ContractDefinition =
  | "ProfileAnswer"
  | "DecodeRequestAnswer"
  | "EncodeResponseAnswer"
  | "EncodeEventAnswer"
  | "RateLimitReplyAnswer"
  | "ModelsAnswer"
  | "IrResponse"
  | "IrFailure"
  | "IrStreamEvent";

/** A plugin answer that its contract refuses, naming the definition and what was wrong. */
export class ContractViolation extends Error {
  constructor(what: string, definition: ContractDefinition, issues: string) {
    super(`${what} does not match ${definition}: ${issues}`);
    this.name = "ContractViolation";
  }
}

/** Checks plugin answers against the contract schemas; `check` answers the value typed, or throws a {@link ContractViolation}. */
export interface ContractChecks {
  check<T>(definition: ContractDefinition, value: unknown, what: string): T;
  matches(definition: ContractDefinition, value: unknown): boolean;
}

function validatorsOf(contractsDirectory: string): Map<string, ValidateFunction> {
  const ajv = new Ajv({ strict: false, allErrors: true });
  const references = new Map<string, string>();
  for (const file of SCHEMA_FILES) {
    const schema = JSON.parse(readFileSync(join(contractsDirectory, file), "utf8")) as { $id: string; definitions: Record<string, unknown> };
    ajv.addSchema(schema);
    for (const name of Object.keys(schema.definitions)) references.set(name, `${schema.$id}#/definitions/${name}`);
  }
  const validators = new Map<string, ValidateFunction>();
  for (const [name, reference] of references) validators.set(name, ajv.getSchema(reference) as ValidateFunction);
  return validators;
}

/** The checks for the contract schemas in `contractsDirectory`, the `contracts` folder of the opened `forebay/library`. */
export function contractChecks(contractsDirectory: string): ContractChecks {
  const validators = validatorsOf(contractsDirectory);
  const validatorFor = (definition: ContractDefinition) => {
    const validator = validators.get(definition);
    if (validator === undefined) throw new Error(`the contracts in ${contractsDirectory} define no ${definition}`);
    return validator;
  };
  return {
    matches: (definition, value) => validatorFor(definition)(value) === true,
    check<T>(definition: ContractDefinition, value: unknown, what: string): T {
      const validator = validatorFor(definition);
      if (validator(value)) return value as T;
      const issues = (validator.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`).join("; ");
      throw new ContractViolation(what, definition, issues);
    },
  };
}
