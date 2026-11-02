import { describe, expect, it } from "vitest";
import { settingsView } from "./settings-view.js";

describe("settingsView", () => {
  it("generates one form holding one field node per setting, in key order", () => {
    const view = settingsView({
      id: "tools",
      api: 1,
      settings: {
        theme: { type: "choice", label: "Theme", choices: ["light", "dark"] },
        depth: { type: "number", label: "Depth" },
      },
    });
    expect(view.title).toBe("Settings");
    const [form, ...fields] = view.nodes;
    expect(form.component).toBe("form");
    expect(form.parent).toBeUndefined();
    expect(fields.map((node) => [node.component, node.parent, node.field, node.label])).toEqual([
      ["field", form.id, "depth", "Depth"],
      ["field", form.id, "theme", "Theme"],
    ]);
  });

  it("gives every node an id the model accepts and no two the same", () => {
    const view = settingsView({ id: "tools", api: 1, settings: { "proxy.port": { type: "number", label: "Port" }, settings: { type: "text", label: "Named like the form" } } });
    const ids = view.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][A-Za-z0-9]*$/);
  });

  it("generates an empty form for a plugin declaring no settings", () => {
    expect(settingsView({ id: "tools", api: 1 }).nodes.map((node) => node.component)).toEqual(["form"]);
  });
});
