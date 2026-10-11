import { describe, it, expect } from "vitest";
import { validateRegulatoryRate, REGULATORY_CAPS, MODAL_SENDIRI_CLASSES } from "../src/lib/regulatory-config.js";
import { AppError } from "../src/lib/errors.js";

describe("MODAL_SENDIRI_CLASSES", () => {
  // Permenkop UKM 8/2023 Pasal 1 angka 23 (+ angka 24 Modal Tetap for USP).
  it("counts pokok, wajib, modal tetap, dana cadangan and hibah as Modal Sendiri", () => {
    expect([...MODAL_SENDIRI_CLASSES].sort()).toEqual(
      ["CADANGAN_RISIKO", "CADANGAN_UMUM", "HIBAH", "MODAL_TETAP", "SIMPANAN_POKOK", "SIMPANAN_WAJIB"].sort()
    );
  });

  it("excludes modal penyertaan, SHU and other equity", () => {
    for (const excluded of ["MODAL_PENYERTAAN", "SHU", "EKUITAS_LAIN"]) {
      expect(MODAL_SENDIRI_CLASSES).not.toContain(excluded);
    }
  });
});

describe("validateRegulatoryRate", () => {
  it("rejects a LOAN rate above 24%/year", () => {
    expect(() => validateRegulatoryRate("LOAN", 24.01)).toThrow(AppError);
    try {
      validateRegulatoryRate("LOAN", 30);
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("RATE_EXCEEDS_REGULATORY_CAP");
    }
  });

  it("allows a LOAN rate exactly at the 24% cap", () => {
    expect(() => validateRegulatoryRate("LOAN", REGULATORY_CAPS.LOAN_ANNUAL_RATE_MAX_PCT)).not.toThrow();
  });

  it("allows a LOAN rate below the cap", () => {
    expect(() => validateRegulatoryRate("LOAN", 12)).not.toThrow();
  });

  it("rejects a SAVING rate above 9%/year", () => {
    expect(() => validateRegulatoryRate("SAVING", 9.5)).toThrow(AppError);
  });

  it("allows a SAVING rate exactly at the 9% cap", () => {
    expect(() => validateRegulatoryRate("SAVING", REGULATORY_CAPS.SAVING_ANNUAL_RATE_MAX_PCT)).not.toThrow();
  });

  it("allows a SAVING rate below the cap", () => {
    expect(() => validateRegulatoryRate("SAVING", 3)).not.toThrow();
  });
});
