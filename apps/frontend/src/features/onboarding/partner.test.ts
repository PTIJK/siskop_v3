import { describe, expect, it } from "vitest";
import { applicationProblems, buildApplication, EMPTY_APPLICATION, PARTNER_TERMS_VERSION, type PartnerApplicationForm } from "./partner";

const valid = (over: Partial<PartnerApplicationForm> = {}): PartnerApplicationForm => ({
  ...EMPTY_APPLICATION,
  name: "Budi Santoso",
  email: "budi@mitra.id",
  phone: "0812 3456 7890",
  ktpNo: "3578010101900001",
  bankName: "BCA",
  bankAccountNo: "1234567890",
  bankAccountName: "Budi Santoso",
  acceptTerms: true,
  ...over
});

describe("applicationProblems", () => {
  it("is empty for a complete form", () => {
    expect(applicationProblems(valid())).toEqual([]);
  });

  it("names each missing or malformed field", () => {
    const problems = applicationProblems(valid({ name: "B", email: "x", phone: "123", ktpNo: "12", bankName: "", bankAccountNo: "ab", bankAccountName: "", acceptTerms: false }));
    expect(problems).toHaveLength(8);
  });

  it("accepts +62 and spaced phones", () => {
    expect(applicationProblems(valid({ phone: "+62 812-3456-7890" }))).toEqual([]);
  });

  it("requires exactly 16 digits for the KTP", () => {
    expect(applicationProblems(valid({ ktpNo: "357801010190000" }))).toHaveLength(1);
    expect(applicationProblems(valid({ ktpNo: "35780101019000AB" }))).toHaveLength(1);
  });
});

describe("buildApplication", () => {
  it("trims, stamps the terms version and omits blank optional fields", () => {
    const body = buildApplication(valid({ name: "  Budi Santoso ", city: " ", npwp: "", salesPlan: " Jaringan " }));
    expect(body).toMatchObject({ name: "Budi Santoso", termsVersion: PARTNER_TERMS_VERSION, acceptTerms: true, salesPlan: "Jaringan" });
    expect("city" in body).toBe(false);
    expect("npwp" in body).toBe(false);
  });

  it("never sends commission terms", () => {
    expect(JSON.stringify(buildApplication(valid()))).not.toMatch(/commission|rate/i);
  });
});
