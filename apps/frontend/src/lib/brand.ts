/**
 * White-label brand colour (design.md §2.5). A tenant picks one colour; it only
 * replaces --brand, --ring and the --accent tint. It is rejected unless white
 * text on it reaches WCAG AA (4.5:1), because buttons and links on --brand use
 * white text in light mode. --primary (ink) is never touched.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const MIN_BRAND_CONTRAST = 4.5;

/** "#1d4ed8" or "#14d" -> rgb; null for anything else. */
export function parseHex(input: string): Rgb | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!match) return null;
  let hex = match[1] ?? "";
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };

export function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}

export type BrandCheck =
  | { ok: true; contrast: number; hex: string }
  | { ok: false; reason: "format" | "contrast"; contrast?: number };

/** Format check, then white-text contrast on the colour. */
export function checkBrandColor(input: string): BrandCheck {
  const rgb = parseHex(input);
  if (!rgb) return { ok: false, reason: "format" };
  const contrast = contrastRatio(WHITE, rgb);
  const hex = `#${[rgb.r, rgb.g, rgb.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  if (contrast < MIN_BRAND_CONTRAST) return { ok: false, reason: "contrast", contrast };
  return { ok: true, contrast, hex };
}

/** Indonesian message for a failed check, quoting the measured contrast. */
export function brandCheckMessage(check: BrandCheck): string {
  if (check.ok) return `Kontras teks putih ${check.contrast.toFixed(1).replace(".", ",")}:1, memenuhi syarat.`;
  if (check.reason === "format") return "Tulis warna sebagai kode heks, mis. #1D4ED8.";
  return `Warna ini terlalu terang: kontras teks putih hanya ${(check.contrast ?? 0).toFixed(1).replace(".", ",")}:1, minimal ${MIN_BRAND_CONTRAST.toString().replace(".", ",")}:1. Pilih warna yang lebih gelap.`;
}

const fmt = (n: number) => `${Math.round(n)}`;

/** CSS for the tenant brand: light values on :root, a lighter variant in .dark (dark text on --brand there). */
export function brandCss(hex: string): string | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const { h, s } = rgbToHsl(rgb);
  const light = rgbToHsl(rgb);
  const hue = fmt(h);
  const sat = fmt(Math.max(s, 20));
  return [
    `:root{--brand:${hue} ${fmt(light.s)}% ${fmt(light.l)}%;--ring:${hue} ${fmt(light.s)}% ${fmt(light.l)}%;--brand-foreground:0 0% 100%;--accent:${hue} ${sat}% 96%;--accent-foreground:${hue} ${sat}% 28%}`,
    `.dark{--brand:${hue} ${sat}% 74%;--ring:${hue} ${sat}% 74%;--brand-foreground:224 30% 10%;--accent:${hue} ${fmt(Math.min(sat === "0" ? 0 : Number(sat), 45))}% 20%;--accent-foreground:${hue} ${sat}% 88%}`
  ].join("\n");
}

const STYLE_ID = "tenant-brand";

/** Installs (or with null removes) the tenant brand override. Invalid or low-contrast colours are ignored, never applied. */
export function applyBrandColor(hex: string | null | undefined): void {
  if (typeof document === "undefined") return;
  const existing = document.getElementById(STYLE_ID);
  const check = hex ? checkBrandColor(hex) : null;
  if (!hex || !check || !check.ok) {
    existing?.remove();
    return;
  }
  const css = brandCss(check.hex);
  if (!css) return;
  const el = existing ?? document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = css;
  if (!existing) document.head.append(el);
}
