export interface HostIdentity {
  id: string;
  version: string;
  home: string;
  application?: Record<string, unknown>;
  requiresCommand: boolean;
  commands: ReadonlyArray<{ name: string; target: string }>;
}
