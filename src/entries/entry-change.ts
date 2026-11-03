import type { HostPlaces } from "../context/places.js";
import type { LoaderApplication } from "../loader/standard.js";

/** One change an application entry asks the runtime to make and record, in the shape `changes.apply` takes. */
export type EntryChange =
  | { kind: "directory"; path: string }
  | { kind: "file"; path: string; content: string }
  | { kind: "json-key"; file: string; key: string[]; value: unknown; create?: boolean };

/** A registered loader an entry is written for, with the application home it resolved. */
export interface EntryLoader {
  id: string;
  application: LoaderApplication;
  home: string;
}

/** The changes that make an application start loader `loader`'s host through its own plugin mechanism, in the order they apply. */
export type EntryWriter = (places: HostPlaces, loader: EntryLoader) => EntryChange[];

/** A file's content as `JSON.stringify(value, null, 2)` and a newline, the form the applications write their own JSON in. */
export function jsonContent(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
