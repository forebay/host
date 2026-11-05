import type { ModelsAnswer } from "../contracts/index.js";
import type { ModelsArgument, ProviderCatalog } from "../forebay-library/types.js";
import type { ProviderCalls } from "./providers.js";

/** What every provider answered to `models`, shaped as `routing.*` reads it. */
export interface ProviderModels {
  argument: ModelsArgument;
  answers: Map<string, ModelsAnswer>;
}

function catalogOf(answer: ModelsAnswer): ProviderCatalog {
  return {
    models: Object.fromEntries(answer.models.map((model) => [model.id, { name: model.name, limit: { context: model.context, output: model.output } }])),
    ranking: answer.models.map((model) => model.id),
    ...(answer.defaultModelId === undefined ? {} : { defaultModelId: answer.defaultModelId }),
  };
}

/** Asks every provider for its models; one that fails is left out and reported through `onFailure`. */
export async function providerModels(providers: Iterable<ProviderCalls>, onFailure: (providerId: string, error: unknown) => void): Promise<ProviderModels> {
  const answers = new Map<string, ModelsAnswer>();
  for (const provider of providers) {
    try {
      answers.set(provider.id, await provider.models());
    } catch (error) {
      onFailure(provider.id, error);
    }
  }
  return { argument: Object.fromEntries([...answers].map(([id, answer]) => [id, catalogOf(answer)])), answers };
}
