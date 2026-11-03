declare module "cross-spawn/lib/util/escape.js" {
  export function command(text: string): string;
  export function argument(text: string, doubleEscapeMetaChars: boolean): string;
}
