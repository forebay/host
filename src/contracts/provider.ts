import type { IrFailure, IrResponse, IrStreamEvent } from "./ir.js";

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
