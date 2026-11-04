import { describe, expect, it } from "vitest";
import { approveBody, createPartnerBody, createPayoutBody, markPaidBody, statementPath, EMPTY_PARTNER_FORM, partnerEditBody, percent, rejectProblem, settingsBody, shareLink, termsChangeBody } from "./helpers";

describe("percent", () => {
  it("shows a stored fraction as a percentage", () => {
    expect(percent("0.2000")).toBe("20%");
    expect(percent("0.125")).toBe("12,5%");
    expect(percent("0")).toBe("0%");
  });
});

describe("approveBody", () => {
  it("sends nothing when the admin keeps the defaults", () => {
    expect(approveBody({ code: "", ratePercent: "", months: "" })).toEqual({ ok: true, body: {} });
  });

  it("converts percent to a fraction and normalises the code", () => {
    expect(approveBody({ code: " budi ", ratePercent: "30", months: "6" })).toEqual({
      ok: true,
      body: { code: "budi", commissionRate: "0.3", commissionMonths: 6 }
    });
    expect(approveBody({ code: "", ratePercent: "12,5", months: "" })).toEqual({ ok: true, body: { commissionRate: "0.125" } });
  });

  it("rejects a rate above 50% or months outside 1-60", () => {
    expect(approveBody({ code: "", ratePercent: "51", months: "" }).ok).toBe(false);
    expect(approveBody({ code: "", ratePercent: "-1", months: "" }).ok).toBe(false);
    expect(approveBody({ code: "", ratePercent: "", months: "0" }).ok).toBe(false);
    expect(approveBody({ code: "", ratePercent: "", months: "61" }).ok).toBe(false);
    expect(approveBody({ code: "", ratePercent: "abc", months: "" }).ok).toBe(false);
  });
});

describe("rejectProblem", () => {
  it("needs a reason of at least 3 characters", () => {
    expect(rejectProblem("  ")).not.toBeNull();
    expect(rejectProblem("ok")).not.toBeNull();
    expect(rejectProblem("KTP tidak sesuai")).toBeNull();
  });
});

describe("shareLink", () => {
  it("builds the register link with the code, without doubled slashes", () => {
    expect(shareLink("https://siskop.id/", "NEX-ABC123")).toBe("https://siskop.id/register?ref=NEX-ABC123");
    expect(shareLink("https://siskop.id", "NEX-ABC123")).toBe("https://siskop.id/register?ref=NEX-ABC123");
  });
});

describe("termsChangeBody", () => {
  it("needs a reason and at least one change", () => {
    expect(termsChangeBody({ ratePercent: "", months: "", reason: "Alasan" }).ok).toBe(false);
    expect(termsChangeBody({ ratePercent: "10", months: "", reason: "" }).ok).toBe(false);
  });

  it("sends only what changed, with the rate as a fraction", () => {
    expect(termsChangeBody({ ratePercent: "10", months: "", reason: " Diskon " })).toEqual({ ok: true, body: { rate: "0.1", reason: "Diskon" } });
    expect(termsChangeBody({ ratePercent: "", months: "6", reason: "Diskon" })).toEqual({ ok: true, body: { months: 6, reason: "Diskon" } });
  });

  it("rejects out-of-range values", () => {
    expect(termsChangeBody({ ratePercent: "60", months: "", reason: "Diskon" }).ok).toBe(false);
    expect(termsChangeBody({ ratePercent: "", months: "70", reason: "Diskon" }).ok).toBe(false);
  });
});

describe("settingsBody", () => {
  it("requires both values and a reason, and converts percent", () => {
    expect(settingsBody({ ratePercent: "25", months: "9", reason: "Kebijakan baru" })).toEqual({
      ok: true,
      body: { defaultRate: "0.25", defaultMonths: 9, reason: "Kebijakan baru" }
    });
    expect(settingsBody({ ratePercent: "", months: "9", reason: "Kebijakan baru" }).ok).toBe(false);
    expect(settingsBody({ ratePercent: "25", months: "9", reason: "" }).ok).toBe(false);
  });
});

describe("createPartnerBody", () => {
  const form = {
    name: " Siti Agen ",
    email: "siti@agen.id",
    phone: "0813 1111 2222",
    city: "",
    province: "",
    ktpNo: "3573010101900002",
    npwp: "",
    bankName: "Mandiri",
    bankAccountNo: "9876543210",
    bankAccountName: "Siti Agen",
    notes: "",
    code: " siti ",
    ratePercent: "",
    months: ""
  };

  it("builds a body without terms or honeypot fields and with only the overrides given", () => {
    const result = createPartnerBody(form);
    expect(result).toMatchObject({ ok: true, body: { name: "Siti Agen", code: "siti" } });
    if (result.ok) expect(Object.keys(result.body)).not.toEqual(expect.arrayContaining(["acceptTerms", "termsVersion", "website", "commissionRate"]));
  });

  it("reports form problems and bad overrides", () => {
    expect(createPartnerBody({ ...form, ktpNo: "1" }).ok).toBe(false);
    expect(createPartnerBody({ ...form, ratePercent: "70" }).ok).toBe(false);
  });
});

describe("partnerEditBody", () => {
  const original = { commissionRate: "0.2000", commissionMonths: 12, status: "ACTIVE" as const };
  const form = { ...EMPTY_PARTNER_FORM, name: "Siti", email: "s@a.id", phone: "081311112222", ktpNo: "x", bankName: "BCA", bankAccountNo: "123456", bankAccountName: "Siti", ratePercent: "20", months: "12", status: "ACTIVE" as const, reason: "" };

  it("needs no reason when only contact data changes", () => {
    const result = partnerEditBody(form, original);
    expect(result.ok).toBe(true);
    if (result.ok) expect("reason" in result.body).toBe(false);
  });

  it("needs a reason once rate, months or status differ", () => {
    expect(partnerEditBody({ ...form, ratePercent: "25" }, original).ok).toBe(false);
    expect(partnerEditBody({ ...form, months: "6" }, original).ok).toBe(false);
    expect(partnerEditBody({ ...form, status: "SUSPENDED" }, original).ok).toBe(false);
    const ok = partnerEditBody({ ...form, ratePercent: "25", reason: " Negosiasi " }, original);
    expect(ok).toMatchObject({ ok: true, body: { commissionRate: "0.25", reason: "Negosiasi" } });
  });

  it("clears an emptied optional field with null", () => {
    const result = partnerEditBody({ ...form, city: "" }, original);
    expect(result).toMatchObject({ ok: true, body: { city: null } });
  });
});

describe("createPayoutBody", () => {
  it("needs a partner and a cutoff date", () => {
    expect(createPayoutBody("", "2026-03-31").ok).toBe(false);
    expect(createPayoutBody("p1", "").ok).toBe(false);
    expect(createPayoutBody("p1", "2026-03-31")).toEqual({ ok: true, body: { partnerId: "p1", periodEnd: "2026-03-31" } });
  });
});

describe("markPaidBody", () => {
  it("requires a transfer reference", () => {
    expect(markPaidBody({ transferRef: " ", paidOn: "", taxWithheld: "" }, "500000.00").ok).toBe(false);
  });

  it("sends only what was filled, with the paid date as a Jakarta noon instant", () => {
    expect(markPaidBody({ transferRef: " TRF-1 ", paidOn: "", taxWithheld: "" }, "500000.00")).toEqual({ ok: true, body: { transferRef: "TRF-1" } });
    expect(markPaidBody({ transferRef: "TRF-1", paidOn: "2026-04-05", taxWithheld: "25000" }, "500000.00")).toEqual({
      ok: true,
      body: { transferRef: "TRF-1", paidAt: "2026-04-05T05:00:00.000Z", taxWithheld: "25000" }
    });
  });

  it("keeps tax a non-negative amount within the gross", () => {
    expect(markPaidBody({ transferRef: "T", paidOn: "", taxWithheld: "-1" }, "500000.00").ok).toBe(false);
    expect(markPaidBody({ transferRef: "T", paidOn: "", taxWithheld: "abc" }, "500000.00").ok).toBe(false);
    expect(markPaidBody({ transferRef: "T", paidOn: "", taxWithheld: "500000.01" }, "500000.00").ok).toBe(false);
    expect(markPaidBody({ transferRef: "T", paidOn: "", taxWithheld: "500000" }, "500000.00").ok).toBe(true);
  });
});

describe("statementPath", () => {
  it("adds only the dates given and refuses a reversed period", () => {
    expect(statementPath("p1", "", "")).toEqual({ ok: true, body: "/platform/partners/p1/statement.csv" });
    expect(statementPath("p1", "2026-03-01", "2026-03-31")).toEqual({ ok: true, body: "/platform/partners/p1/statement.csv?from=2026-03-01&to=2026-03-31" });
    expect(statementPath("p1", "2026-04-01", "2026-03-31").ok).toBe(false);
  });
});
