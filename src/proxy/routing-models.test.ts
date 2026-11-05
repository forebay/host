import { describe, expect, it } from "vitest";
import type { ModelsAnswer } from "../contracts/index.js";
import type { ProviderCalls } from "./providers.js";
import { REDERIVE_INTERVAL_MILLISECONDS, startRoutingModels } from "./routing-models.js";

const SILENT_LOG = { info: () => undefined, warn: () => undefined };

function countingProvider(answers: () => ModelsAnswer): ProviderCalls & { asked: number } {
  const provider = {
    id: "counted",
    asked: 0,
    models: async () => {
      provider.asked++;
      return answers();
    },
    handleIr: () => Promise.reject(new Error("not called")),
  };
  return provider;
}

describe("the routing models a request finding no model asks again", () => {
  it("asks once for concurrent requests, not again within the interval, and again after it", async () => {
    let clock = 0;
    let offered: ModelsAnswer = { models: [] };
    const provider = countingProvider(() => offered);
    const models = await startRoutingModels({ providers: [provider], mapOf: () => ({}), log: SILENT_LOG, now: () => clock });
    try {
      expect(provider.asked).toBe(1);
      await Promise.all([models.rederive(), models.rederive()]);
      expect(provider.asked).toBe(1);
      clock += REDERIVE_INTERVAL_MILLISECONDS;
      offered = { models: [{ id: "m", name: "M", context: 1, output: 1 }] };
      await Promise.all([models.rederive(), models.rederive(), models.rederive()]);
      expect(provider.asked).toBe(2);
      expect(Object.keys(models.snapshot().models.counted?.models ?? {})).toEqual(["m"]);
    } finally {
      models.stop();
    }
  });
});
