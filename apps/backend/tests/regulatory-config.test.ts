import { describe, it, expect } from "vitest";
import { validateRegulatoryRate, REGULATORY_CAPS } from "../src/lib/regulatory-config.js";
import { AppError } from "../src/lib/errors.js";

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
