import type { ModelsAnswer } from "../contracts/index.js";
import type { ModelsArgument, ProviderCatalog } from "../forebay-library/types.js";

function catalogOf(answer: ModelsAnswer): ProviderCatalog {
  return {
    models: Object.fromEntries(answer.models.map((model) => [model.id, { name: model.name, limit: { context: model.context, output: model.output } }])),
    ranking: answer.models.map((model) => model.id),
    ...(answer.defaultModelId === undefined ? {} : { defaultModelId: answer.defaultModelId }),
  };
}

/** What the providers answered to `models`, shaped as `routing.*` reads it. */
export function modelsArgumentOf(answers: ReadonlyMap<string, ModelsAnswer>): ModelsArgument {
  return Object.fromEntries([...answers].map(([id, answer]) => [id, catalogOf(answer)]));
}
