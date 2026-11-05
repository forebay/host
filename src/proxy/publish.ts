import type { Runtime } from "../runtime/open.js";

/** Publishes the session host's ready record, which `launch` waits on before it starts the application. */
export interface ReadyPublisher {
  environment(environment: Record<string, string>): void;
  refusal(refused: string, fix: string): void;
}

export function readyPublisher(runtime: Pick<Runtime, "processes">, state: string, hostId: string, pid: number = process.pid): ReadyPublisher {
  return {
    environment: (environment) => {
      runtime.processes.ready({ state, hostId, pid, environment });
    },
    refusal: (refused, fix) => {
      runtime.processes.ready({ state, hostId, pid, refused, fix });
    },
  };
}
