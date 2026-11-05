import type { IrFailure, IrRequest, IrResponse, IrStreamEvent } from "./ir.js";

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

/** An application's request as the session host received it, its body buffered as text. */
export interface WireRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface RateLimitReplyArgument {
  /** The headers of the last rate-limited answer, the one the reply stands in for. */
  upstreamHeaders: Record<string, string>;
  resetAt?: number;
  now: number;
  timeZone: string;
}

/** What a plugin providing the `front-door` capability hands to `context.provide`. */
export interface FrontDoor {
  profile(): Profile | Promise<Profile>;
  decodeRequest(request: WireRequest): DecodeRequestAnswer | Promise<DecodeRequestAnswer>;
  encodeResponse(response: IrResponse): EncodeResponseAnswer | Promise<EncodeResponseAnswer>;
  encodeEvent(event: IrStreamEvent): EncodeEventAnswer | Promise<EncodeEventAnswer>;
  rateLimitReply(argument: RateLimitReplyArgument): RateLimitReplyAnswer | Promise<RateLimitReplyAnswer>;
}
