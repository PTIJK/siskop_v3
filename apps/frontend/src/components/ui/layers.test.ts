import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(resolve(__dirname, file), "utf8");
const zBlock = /zIndex:\s*\{([^}]*)\}/.exec(source("../../../tailwind.config.js"))?.[1] ?? "";
const z = Object.fromEntries([...zBlock.matchAll(/(\w+):\s*"(\d+)"/g)].map(([, name, value]) => [name, value]));

describe("stacking layers", () => {
  it("puts portaled floating content above dialogs and drawers, below toasts", () => {
    expect(Number(z.floating)).toBeGreaterThan(Number(z.modal));
    expect(Number(z.floating)).toBeGreaterThan(Number(z.drawer));
    expect(Number(z.floating)).toBeLessThan(Number(z.toast));
  });

  // These portal to <body>, outside the dialog: z-popover (below the scrim) hid them behind it.
  it.each(["select.tsx", "dropdown-menu.tsx"])("%s portals its content on the floating layer", (file) => {
    const text = source(file);
    expect(text).toContain("z-floating");
    expect(text).not.toContain("z-popover");
  });
});
