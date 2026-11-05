import type { ModelsAnswer } from "../contracts/index.js";
import type { ModelMap, ModelsArgument } from "../forebay-library/types.js";
import type { ProxyLog, RoutingSnapshot } from "./handle-request.js";
import { modelsArgumentOf } from "./models.js";
import type { ProviderCalls } from "./providers.js";

/** How long a start, or a request finding no model, waits for the providers' models before going on with what answered. */
export const MODELS_BUDGET_MILLISECONDS = 2000;
/** The least time between two asks a request finding no model makes, so a burst of such requests asks once. */
export const REDERIVE_INTERVAL_MILLISECONDS = 3000;
const REFRESH_EVERY_MILLISECONDS = 60 * 60 * 1000;

export interface RoutingModelsOptions {
  providers: Iterable<ProviderCalls>;
  /** The model map routing reads for these models, throwing when the stored map is refused. */
  mapOf(models: ModelsArgument): ModelMap;
  log: ProxyLog;
  now(): number;
}

/** The routing snapshot the proxy reads, kept current as the providers answer `models`. */
export interface RoutingModels {
  snapshot(): RoutingSnapshot;
  /**
   * Asks every provider again, unless a request asked less than REDERIVE_INTERVAL_MILLISECONDS ago,
   * answering once their models are in or the budget is spent; requests meanwhile share that ask.
   */
  rederive(): Promise<void>;
  stop(): void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withinBudget(work: Promise<unknown>, milliseconds: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const spent = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
  return Promise.race([work.then(() => undefined), spent]).finally(() => clearTimeout(timer));
}

/**
 * Asks every provider for its models in parallel and answers within the budget with the snapshot
 * of whatever answered; each model list arriving after it rebuilds the snapshot on its own, and the
 * providers are asked again every hour.
 *
 * @implNote A provider that fails an ask keeps the models it answered last, so one briefly
 * unreachable does not empty the map. Only the first derive may refuse the start; a later one that
 * is refused keeps the snapshot it had.
 */
export async function startRoutingModels(options: RoutingModelsOptions): Promise<RoutingModels> {
  const providers = [...options.providers];
  const answers = new Map<string, ModelsAnswer>();
  let stopped = false;
  let lastAsked = Number.NEGATIVE_INFINITY;
  let shared: Promise<void> | undefined;

  const derived = (): RoutingSnapshot => {
    const models = modelsArgumentOf(answers);
    return { models, answers: new Map(answers), map: options.mapOf(models) };
  };
  const rebuildKeepingTheLast = (): void => {
    if (stopped) return;
    try {
      current = derived();
    } catch (error) {
      options.log.warn(`the model map could not be derived again, so routing keeps the last one: ${messageOf(error)}`);
    }
  };
  const askOne = async (provider: ProviderCalls, isLate: () => boolean): Promise<void> => {
    try {
      const answer = await provider.models();
      if (stopped) return;
      answers.set(provider.id, answer);
      if (isLate()) rebuildKeepingTheLast();
    } catch (error) {
      if (!stopped) options.log.warn(`${provider.id} answered no models: ${messageOf(error)}`);
    }
  };
  const askAll = async (): Promise<void> => {
    lastAsked = options.now();
    let late = false;
    await withinBudget(Promise.all(providers.map((provider) => askOne(provider, () => late))), MODELS_BUDGET_MILLISECONDS);
    late = true;
  };

  await askAll();
  let current = derived();
  const timer = setInterval(() => void askAll().then(rebuildKeepingTheLast), REFRESH_EVERY_MILLISECONDS);
  timer.unref();
  return {
    snapshot: () => current,
    rederive: () => {
      if (shared !== undefined) return shared;
      if (options.now() - lastAsked < REDERIVE_INTERVAL_MILLISECONDS) return Promise.resolve();
      shared = askAll()
        .then(rebuildKeepingTheLast)
        .finally(() => (shared = undefined));
      return shared;
    },
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
