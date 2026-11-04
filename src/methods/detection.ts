export type MethodDetection =
  | { method: string; item: string; package: string; options?: object; answer: { installed: boolean; version?: string } }
  | { method: string; item: string; refused: string };
