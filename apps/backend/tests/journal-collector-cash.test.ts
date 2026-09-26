import { describe, it, expect } from "vitest";
import { substituteCollectorCash } from "../src/lib/journal.js";

const KAS = "kas-id";
const KAS_DI_KOLEKTOR = "kas-di-kolektor-id";
const OTHER = "other-account-id";
const mapping = { debitAccountId: KAS, creditAccountId: KAS_DI_KOLEKTOR };

describe("substituteCollectorCash", () => {
  it("redirects a debit-side Kas line (e.g. a DEPOSIT) to Kas di Kolektor", () => {
    const lines = [
      { accountId: KAS, debit: 100000 },
      { accountId: OTHER, credit: 100000 }
    ];
    expect(substituteCollectorCash(lines, mapping)).toEqual([
      { accountId: KAS_DI_KOLEKTOR, debit: 100000 },
      { accountId: OTHER, credit: 100000 }
    ]);
  });

  it("redirects a credit-side Kas line (e.g. a loan DISBURSEMENT) to Kas di Kolektor", () => {
    const lines = [
      { accountId: OTHER, debit: 100000 },
      { accountId: KAS, credit: 100000 }
    ];
    expect(substituteCollectorCash(lines, mapping)).toEqual([
      { accountId: OTHER, debit: 100000 },
      { accountId: KAS_DI_KOLEKTOR, credit: 100000 }
    ]);
  });

  it("leaves lines unchanged when no COLLECTOR_CASH mapping exists (Buat COA Standar not run for this feature yet)", () => {
    const lines = [
      { accountId: KAS, debit: 100000 },
      { accountId: OTHER, credit: 100000 }
    ];
    expect(substituteCollectorCash(lines, null)).toEqual(lines);
  });

  it("leaves lines with no Kas side untouched", () => {
    const lines = [
      { accountId: OTHER, debit: 50000 },
      { accountId: "yet-another", credit: 50000 }
    ];
    expect(substituteCollectorCash(lines, mapping)).toEqual(lines);
  });
});
