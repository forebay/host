import type { Logger, PluginManifest } from "@weivel/typescript";
import type { HostIdentity } from "../identity.js";
import type { Runtime } from "../runtime/open.js";
import type { ActivityPublisher } from "./activity.js";
import type { HostPlaces } from "./places.js";
import { scopeOf } from "./scope.js";
import type { PluginScope } from "./scope.js";

type Level = "debug" | "info" | "warn" | "error";

function causeText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function printToStderr(line: string | undefined): void {
  if (line !== undefined) process.stderr.write(`${line}\n`);
}

/** A logger writing through `log.write` under `scope`, for a plugin or for a part of the host itself. */
export function scopedLogger(runtime: Pick<Runtime, "log">, scope: () => PluginScope, startedAt: string, publish: ActivityPublisher): Logger {
  function write(level: Level, message: string): void {
    try {
      const { console: line } = runtime.log.write({
        ...scope(),
        start: startedAt,
        time: new Date().toISOString(),
        level,
        message,
        noColor: process.env.NO_COLOR !== undefined,
      });
      printToStderr(line);
    } catch {
      return;
    }
  }
  function error(message: string, cause?: unknown): void {
    const text = cause === undefined ? message : `${message}: ${causeText(cause)}`;
    write("error", text);
    try {
      publish("log.error", { message: text });
    } catch {
      return;
    }
  }
  return {
    debug: (message) => write("debug", message),
    info: (message) => write("info", message),
    warn: (message) => write("warn", message),
    error,
  };
}

export function buildLogger(
  runtime: Runtime,
  places: HostPlaces,
  host: HostIdentity,
  manifest: PluginManifest,
  startedAt: string,
  publish: ActivityPublisher,
): Logger {
  return scopedLogger(runtime, () => scopeOf(host, places, manifest), startedAt, publish);
}
