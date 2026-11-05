export type Extensions = Record<string, unknown> | null;

export type IrStopReason = string;

export interface IrUsage {
  cacheCreationInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  totalTokens?: number | null;
}

export interface IrTool {
  description?: string | null;
  extensions?: Extensions;
  inputSchema: unknown;
  name: string;
}

export interface IrToolChoice {
  extensions?: Extensions;
  name?: string | null;
  type: string;
}

export interface IrThinking {
  budgetTokens?: number | null;
  enabled: boolean;
}

export interface IrMessage {
  content: IrBlock[];
  extensions?: Extensions;
  role: string;
}

export interface TextBlock {
  cacheControl?: string | null;
  extensions?: Extensions;
  kind: "text";
  text: string;
}

export interface ImageBlock {
  cacheControl?: string | null;
  data?: string | null;
  extensions?: Extensions;
  kind: "image";
  mediaType: string;
  url?: string | null;
}

export interface ToolUseBlock {
  cacheControl?: string | null;
  extensions?: Extensions;
  id: string;
  input: unknown;
  kind: "tool_use";
  name: string;
}

export interface ToolResultBlock {
  cacheControl?: string | null;
  content: IrBlock[];
  extensions?: Extensions;
  isError?: boolean | null;
  kind: "tool_result";
  toolUseId: string;
}

export interface ThinkingBlock {
  cacheControl?: string | null;
  extensions?: Extensions;
  kind: "thinking";
  signature?: string | null;
  text: string;
}

export interface UnknownBlock {
  cacheControl?: string | null;
  extensions?: Extensions;
  kind: "unknown";
  raw: Record<string, unknown>;
}

export type IrBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock | UnknownBlock;

export interface IrRequest {
  extensions?: Extensions;
  maxTokens?: number | null;
  messages: IrMessage[];
  metadata?: Record<string, unknown> | null;
  model: string;
  stopSequences?: string[] | null;
  stream: boolean;
  system?: IrBlock[] | null;
  temperature?: number | null;
  thinking?: IrThinking | null;
  toolChoice?: IrToolChoice | null;
  tools?: IrTool[] | null;
  topK?: number | null;
  topP?: number | null;
}

export interface IrResponse {
  content: IrBlock[];
  extensions?: Extensions;
  id: string;
  model: string;
  stopReason: IrStopReason;
  usage?: IrUsage | null;
}

export interface MessageStartEvent {
  event: "message_start";
  extensions?: Extensions;
  id?: string | null;
  model?: string | null;
  role?: string | null;
  usage?: IrUsage | null;
}

export interface ContentBlockStartEvent {
  blockKind: "text" | "tool_use" | "thinking";
  event: "content_block_start";
  extensions?: Extensions;
  index: number;
  toolName?: string | null;
  toolUseId?: string | null;
}

export interface TextDeltaEvent {
  event: "text_delta";
  extensions?: Extensions;
  index: number;
  text?: string | null;
}

export interface ThinkingDeltaEvent {
  event: "thinking_delta";
  extensions?: Extensions;
  index: number;
  text?: string | null;
}

export interface ThinkingSignatureEvent {
  event: "thinking_signature";
  extensions?: Extensions;
  index: number;
  signature?: string | null;
}

export interface ToolInputDeltaEvent {
  event: "tool_input_delta";
  extensions?: Extensions;
  index: number;
  partialJson?: string | null;
}

export interface ContentBlockStopEvent {
  event: "content_block_stop";
  extensions?: Extensions;
  index: number;
}

export interface MessageDeltaEvent {
  event: "message_delta";
  extensions?: Extensions;
  stopReason?: IrStopReason | null;
  usage?: IrUsage | null;
}

export interface MessageStopEvent {
  event: "message_stop";
  extensions?: Extensions;
}

export interface ErrorEvent {
  errorType?: string | null;
  event: "error";
  extensions?: Extensions;
  message?: string | null;
}

export type IrStreamEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | ThinkingSignatureEvent
  | ToolInputDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | ErrorEvent;

export interface IrFailure {
  body: string;
  headers: Record<string, string>;
  retryAfterMilliseconds?: number;
  status: number;
}
