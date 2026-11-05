import type { IrFailure, IrRequest, IrResponse, IrStreamEvent } from "./ir.js";

export interface ModelEntry {
  context: number;
  id: string;
  name: string;
  output: number;
}

export interface ModelsAnswer {
  defaultModelId?: string;
  models: ModelEntry[];
}

export type IrEventStream = IrStreamEvent[];

export type HandleIrAnswer = IrResponse | IrFailure | IrEventStream;

/** What `handleIr` may answer: one answer, or the events of a streamed one. */
export type HandleIrResult = IrResponse | IrFailure | IrEventStream | AsyncIterable<IrStreamEvent>;

/** What a plugin providing the `provider` capability hands to `context.provide`; its plugin id is the provider's id. */
export interface Provider {
  models(): ModelsAnswer | Promise<ModelsAnswer>;
  handleIr(request: IrRequest, signal: AbortSignal): HandleIrResult | Promise<HandleIrResult>;
}
