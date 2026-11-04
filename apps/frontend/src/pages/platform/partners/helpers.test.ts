import { describe, expect, it } from "vitest";
import { approveBody, percent, rejectProblem } from "./helpers";

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
