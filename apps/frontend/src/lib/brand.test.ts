import { describe, expect, it } from "vitest";
import { brandCheckMessage, brandCss, checkBrandColor, contrastRatio, parseHex, rgbToHsl } from "./brand";

describe("parseHex", () => {
  it("reads 6 and 3 digit codes with or without #", () => {
    expect(parseHex("#1D4ED8")).toEqual({ r: 29, g: 78, b: 216 });
    expect(parseHex("1d4ed8")).toEqual({ r: 29, g: 78, b: 216 });
    expect(parseHex("#14d")).toEqual({ r: 17, g: 68, b: 221 });
  });

  it("rejects anything that is not a hex colour", () => {
    expect(parseHex("biru")).toBeNull();
    expect(parseHex("#12345")).toBeNull();
    expect(parseHex("")).toBeNull();
  });
});

describe("contrastRatio", () => {
  it("is 21:1 for black on white and 1:1 for identical colours", () => {
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 })).toBeCloseTo(21, 1);
    expect(contrastRatio({ r: 9, g: 9, b: 9 }, { r: 9, g: 9, b: 9 })).toBeCloseTo(1, 5);
  });

  it("the default brand token (233 62% 50%) already passes AA with white text", () => {
    // hsl(233 62% 50%) ~ rgb(48, 61, 207)
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 48, g: 61, b: 207 })).toBeGreaterThan(4.5);
  });
});

describe("checkBrandColor", () => {
  it("accepts a dark enough colour and reports the measured contrast", () => {
    const result = checkBrandColor("#1D4ED8");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contrast).toBeGreaterThan(6);
      expect(result.hex).toBe("#1d4ed8");
    }
  });

  it("rejects a colour whose white-text contrast is below 4.5:1", () => {
    const result = checkBrandColor("#FFEB3B");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("contrast");
      expect(result.contrast).toBeLessThan(4.5);
    }
  });

  it("rejects the borderline mid tones that look fine but fail", () => {
    // Tailwind green-500: ~2.3:1 against white
    expect(checkBrandColor("#22c55e").ok).toBe(false);
  });

  it("rejects malformed input before measuring", () => {
    expect(checkBrandColor("merah")).toEqual({ ok: false, reason: "format" });
  });

  it("explains a rejection in Indonesian with the measured number", () => {
    const message = brandCheckMessage(checkBrandColor("#FFEB3B"));
    expect(message).toContain("terlalu terang");
    expect(message).toMatch(/\d,\d:1/);
    expect(brandCheckMessage(checkBrandColor("xyz"))).toContain("kode heks");
  });
});

describe("brandCss", () => {
  it("overrides only brand, ring and the accent tint, never primary", () => {
    const css = brandCss("#1D4ED8") ?? "";
    expect(css).toContain("--brand:");
    expect(css).toContain("--ring:");
    expect(css).toContain("--accent:");
    expect(css).not.toContain("--primary");
  });

  it("keeps white text on the light brand and switches to ink text on the dark one", () => {
    const css = brandCss("#1D4ED8") ?? "";
    const [light, dark] = css.split("\n");
    expect(light).toContain("--brand-foreground:0 0% 100%");
    expect(dark).toContain("--brand-foreground:224 30% 10%");
  });

  it("returns null for an unparseable colour", () => {
    expect(brandCss("nope")).toBeNull();
  });
});

describe("rgbToHsl", () => {
  it("converts pure red and grey", () => {
    expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 });
    expect(rgbToHsl({ r: 128, g: 128, b: 128 }).s).toBe(0);
  });
});
