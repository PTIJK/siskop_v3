import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, type Rgb } from "./brand";

/** Reads the real design tokens out of index.css so the audit cannot drift from what ships. */
const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing ${selector} in index.css`);
  return css.slice(start, css.indexOf("}", start));
}

function tokens(selector: string): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  for (const m of block(selector).matchAll(/--([a-z0-9-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g)) {
    out[m[1] as string] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}

function hslToRgb([h, s, l]: [number, number, number]): Rgb {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

function blend(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  const mix = (a: number, b: number) => Math.round(a * alpha + b * (1 - alpha));
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b) };
}

const THEMES = { terang: tokens(":root"), gelap: tokens(".dark") } as const;

// design.md §2.3: normal text 4.5:1, large text and UI components 3:1.
const TEXT_PAIRS: [string, string][] = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["muted-foreground", "background"],
  ["primary-foreground", "primary"],
  ["brand-foreground", "brand"],
  ["accent-foreground", "accent"],
  ["destructive-foreground", "destructive"],
  ["success", "card"],
  ["warning", "card"],
  ["destructive", "card"],
  ["info", "card"],
  ["hero-foreground", "hero"],
  ["hero-muted", "hero"],
  ["sidebar-foreground", "sidebar"],
  ["popover-foreground", "popover"],
  ["secondary-foreground", "secondary"]
];

describe.each(Object.entries(THEMES))("kontras token, tema %s", (_name, t) => {
  const rgb = (name: string): Rgb => {
    const v = t[name];
    if (!v) throw new Error(`token --${name} missing`);
    return hslToRgb(v);
  };

  it.each(TEXT_PAIRS)("%s di atas %s minimal 4,5:1", (fg, bg) => {
    expect(contrastRatio(rgb(fg), rgb(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["success", 0.13],
    ["warning", 0.15],
    ["destructive", 0.13],
    ["info", 0.13]
  ] as const)("teks %s pada badge berlatar tint %s minimal 4,5:1", (name, alpha) => {
    const bg = blend(rgb(name), rgb("card"), alpha);
    expect(contrastRatio(rgb(name), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("batas kolom isian dan cincin fokus minimal 3:1 (WCAG 1.4.11)", () => {
    expect(contrastRatio(rgb("input"), rgb("card"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(rgb("input"), rgb("background"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(rgb("ring"), rgb("background"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(rgb("ring"), rgb("card"))).toBeGreaterThanOrEqual(3);
  });

  it("angka di dalam segmen KOL terbaca (teks background di atas warna segmen)", () => {
    for (const name of ["success", "info", "warning", "destructive", "foreground"]) {
      expect(contrastRatio(rgb("background"), rgb(name))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
