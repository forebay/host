import { DEFAULT_CALL_TIMEOUT_MS } from "@weivel/typescript/host";
import type { Scheduler } from "@weivel/typescript";
import type { DecodeRequestAnswer, FrontDoor, IrResponse, IrStreamEvent, Profile, RateLimitReplyArgument, WireReply, WireRequest } from "../contracts/index.js";
import type { ContractChecks } from "./contracts.js";
import { calledPlugin } from "./plugin-call.js";

export const FRONT_DOOR_CAPABILITY = "front-door";

/** The front door's four functions and its profile, each called under the read deadline and checked against its contract. */
export interface FrontDoorCalls {
  pluginId: string;
  profile(): Promise<Profile>;
  decodeRequest(request: WireRequest): Promise<DecodeRequestAnswer>;
  encodeResponse(response: IrResponse): Promise<WireReply>;
  encodeEvent(event: IrStreamEvent): Promise<string[]>;
  rateLimitReply(argument: RateLimitReplyArgument): Promise<WireReply>;
}

export function frontDoorCalls(pluginId: string, frontDoor: FrontDoor, checks: ContractChecks, scheduler: Scheduler): FrontDoorCalls {
  const call = <T>(label: string, invoke: () => T | Promise<T>) => calledPlugin(pluginId, `${FRONT_DOOR_CAPABILITY}.${label}`, DEFAULT_CALL_TIMEOUT_MS, invoke, scheduler);
  const what = (label: string) => `${pluginId}'s ${label} answer`;
  return {
    pluginId,
    profile: async () => checks.check<Profile>("ProfileAnswer", await call("profile", () => frontDoor.profile()), what("profile")),
    decodeRequest: async (request) => checks.check<DecodeRequestAnswer>("DecodeRequestAnswer", await call("decodeRequest", () => frontDoor.decodeRequest(request)), what("decodeRequest")),
    encodeResponse: async (response) => checks.check<WireReply>("EncodeResponseAnswer", await call("encodeResponse", () => frontDoor.encodeResponse(response)), what("encodeResponse")),
    encodeEvent: async (event) => checks.check<{ chunks: string[] }>("EncodeEventAnswer", await call("encodeEvent", () => frontDoor.encodeEvent(event)), what("encodeEvent")).chunks,
    rateLimitReply: async (argument) => checks.check<WireReply>("RateLimitReplyAnswer", await call("rateLimitReply", () => frontDoor.rateLimitReply(argument)), what("rateLimitReply")),
  };
}
