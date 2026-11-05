import type { IrFailure, IrRequest } from "./ir.js";

export interface Profile {
  defaultContext: number;
  defaultOutput: number;
  envPrefix: string;
  nativeModelPattern?: string | null;
  tierFallback: string[];
  tierOrder: string[];
  tierRegex: string;
  tierSourceProvider: string;
  upstream: string;
}

export interface WireReply {
  body: string;
  headers: Record<string, string>;
  status: number;
}

export type DecodeRequestAnswer = IrRequest | IrFailure;

export type EncodeResponseAnswer = WireReply;

export interface EncodeEventAnswer {
  chunks: string[];
}

export type RateLimitReplyAnswer = WireReply;
