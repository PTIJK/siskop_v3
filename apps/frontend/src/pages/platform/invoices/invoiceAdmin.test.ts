import { describe, expect, it } from "vitest";
import type { PlatformInvoice } from "@siskop/types";
import { daysOverdue, invoiceActions, paidAtFromInput, statusLabel, todayInputValue, typeLabel } from "./invoiceAdmin";

const invoice = (over: Partial<PlatformInvoice> = {}): PlatformInvoice => ({
  id: "i1",
  number: "INV-202610-0001",
  type: "REGISTRATION",
  status: "OPEN",
  tenant: { id: "t1", name: "Koperasi Maju", slug: "maju" },
  packageName: "Small",
  billingCycle: "MONTHLY",
  subtotal: "500000.00",
  taxRate: "0.1100",
  taxAmount: "55000.00",
  total: "555000.00",
  dueDate: "2026-10-20T00:00:00.000Z",
  createdAt: "2026-10-06T00:00:00.000Z",
  paidAt: null,
  paymentMethod: null,
  ...over
});

describe("labels", () => {
  it("names every status and type in Indonesian", () => {
    expect(statusLabel("OPEN")).toBe("Menunggu pembayaran");
    expect(statusLabel("PAID")).toBe("Lunas");
    expect(statusLabel("EXPIRED")).toBe("Kedaluwarsa");
    expect(statusLabel("VOID")).toBe("Dibatalkan");
    expect(typeLabel("REGISTRATION")).toBe("Pendaftaran");
    expect(typeLabel("RENEWAL")).toBe("Perpanjangan");
  });
});

describe("invoiceActions", () => {
  it("lets the owner settle, cancel or reissue an unpaid registration invoice", () => {
    expect(invoiceActions(invoice())).toEqual({ markPaid: true, void: true, reissue: true });
  });

  it("does not offer reissue for a renewal: voiding it makes the next billing run issue a new one", () => {
    expect(invoiceActions(invoice({ type: "RENEWAL" }))).toEqual({ markPaid: true, void: true, reissue: false });
  });

  it("offers only reissue for an expired registration invoice", () => {
    expect(invoiceActions(invoice({ status: "EXPIRED" }))).toEqual({ markPaid: false, void: false, reissue: true });
  });

  it("offers nothing for a paid or void invoice", () => {
    for (const status of ["PAID", "VOID"] as const) {
      expect(invoiceActions(invoice({ status }))).toEqual({ markPaid: false, void: false, reissue: false });
    }
  });
});

describe("daysOverdue", () => {
  const now = new Date("2026-10-25T10:00:00.000Z");

  it("counts whole days past the due date of an open invoice", () => {
    expect(daysOverdue(invoice(), now)).toBe(5);
  });

  it("is zero before the due date and for invoices that are not open", () => {
    expect(daysOverdue(invoice({ dueDate: "2026-11-01T00:00:00.000Z" }), now)).toBe(0);
    expect(daysOverdue(invoice({ status: "PAID" }), now)).toBe(0);
  });
});

describe("payment date input", () => {
  const now = new Date(2026, 9, 25, 9, 30); // local time

  it("formats today for the date field's max", () => {
    expect(todayInputValue(now)).toBe("2026-10-25");
  });

  it("leaves today's date to the server so it records the real moment", () => {
    expect(paidAtFromInput("2026-10-25", now)).toBeUndefined();
    expect(paidAtFromInput("", now)).toBeUndefined();
  });

  it("sends an earlier day as noon of that day", () => {
    const iso = paidAtFromInput("2026-10-22", now);
    expect(new Date(iso as string).getTime()).toBe(new Date(2026, 9, 22, 12, 0, 0).getTime());
  });
});
