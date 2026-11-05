import type { ServerResponse } from "node:http";
import type { ModelsAnswer, Profile } from "../contracts/index.js";
import { writeJson } from "./replies.js";

const CREATED_AT = "2025-01-01T00:00:00Z";
const MODELS_PATH = "/v1/models";

interface ListedModel {
  type: "model";
  id: string;
  display_name: string;
  created_at: string;
  max_input_tokens: number;
  max_tokens: number;
}

/** @implNote The same id offered by several providers is listed once, as the first provider offers it. */
function listedModels(answers: Map<string, ModelsAnswer>, profile: Profile): ListedModel[] {
  const listed = new Map<string, ListedModel>();
  for (const answer of answers.values()) {
    for (const model of answer.models) {
      if (listed.has(model.id)) continue;
      listed.set(model.id, {
        type: "model",
        id: model.id,
        display_name: model.name === "" ? model.id : model.name,
        created_at: CREATED_AT,
        max_input_tokens: model.context ?? profile.defaultContext,
        max_tokens: model.output ?? profile.defaultOutput,
      });
    }
  }
  return [...listed.values()];
}

export function isModelsPath(method: string, path: string): boolean {
  return method === "GET" && (path === MODELS_PATH || path.startsWith(`${MODELS_PATH}/`));
}

/** Answers `/v1/models` and `/v1/models/<id>` from what the providers answered to `models`. */
export function writeModels(response: ServerResponse, path: string, answers: Map<string, ModelsAnswer>, profile: Profile): void {
  const models = listedModels(answers, profile);
  const id = decodeURIComponent(path.slice(MODELS_PATH.length + 1));
  if (id !== "") {
    const found = models.find((model) => model.id === id);
    if (found !== undefined) writeJson(response, 200, found);
    else writeJson(response, 404, { type: "error", error: { type: "not_found_error", message: `model not found: ${id}` } });
    return;
  }
  writeJson(response, 200, { data: models, first_id: models[0]?.id ?? null, last_id: models.at(-1)?.id ?? null, has_more: false });
}
