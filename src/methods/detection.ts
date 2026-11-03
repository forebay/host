export type MethodDetection =
  | { method: string; item: string; package: string; answer: { installed: boolean; version?: string } }
  | { method: string; item: string; refused: string };
