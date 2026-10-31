import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { runMigration } from "../src/modules/migration/importer.js";
import { parseRows } from "../src/modules/migration/rows.js";
import { validateData } from "../src/modules/migration/validate.js";
import { readWorkbook } from "../src/modules/migration/workbook.js";
import { ANGGOTA, fixtureWorkbook, KOPERASI, PINJAMAN, SIMPANAN_POKOK, UNIT } from "./migration-fixtures.js";

const NIK1 = "3578012345670001";
beforeEach(async () => {
  await db.tenant.deleteMany({});
});

describe("runMigration (LAPORAN)", () => {
  it("builds an estimated schedule from the remaining balance and balances the neraca", async () => {
    const p = parseRows(
      await readWorkbook(
        await fixtureWorkbook("LAPORAN", {
          "1_Koperasi": [KOPERASI],
          "2_Unit": [UNIT],
          "4_Produk_Simpanan": [SIMPANAN_POKOK],
          "6_Produk_Pinjaman": [PINJAMAN],
          "3_Anggota": [ANGGOTA(NIK1, "Siti")],
          "5_Saldo_Simpanan": [{ nik: NIK1, productCode: "SP", balance: 1000000 }],
          "7_Pinjaman": [{ loanRef: "L-1", nik: NIK1, productCode: "PJ", remainingPrincipal: 600000, remainingAmount: 660000, termMonths: 6 }],
          "9_Neraca": [
            { reportName: "Kas", accountCode: "1-1000", amount: 900000 },
            { reportName: "Piutang", accountCode: "1-1100", amount: 600000 },
            { reportName: "Penyisihan", accountCode: "1-1190", amount: 100000 },
            { reportName: "Simpanan Pokok", accountCode: "3-1000", amount: 1000000 },
            { reportName: "Cadangan", accountCode: "3-2000", amount: 400000 }
          ]
        })
      )
    );
    expect(validateData(p.data!).issues.filter((i) => i.severity === "error")).toEqual([]);

    const r = await db.$transaction(
      (tx) =>
        runMigration(tx, p.data!, {
          identity: { id: randomUUID(), email: "a@b.test", passwordHash: "x", firebaseUid: null, authProvider: null },
          requestId: "t",
          actorUserId: null
        }),
      { timeout: 60_000 }
    );

    const loan = await db.loan.findFirstOrThrow({ where: { tenantId: r.tenantId } });
    expect(loan.notes).toMatch(/estimasi/);
    expect(loan.disbursedAt!.toISOString().slice(0, 10)).toBe("2025-12-31");
    const inst = await db.loanInstallment.findMany({ where: { loanId: loan.id, tenantId: r.tenantId }, orderBy: { seq: "asc" } });
    expect(inst).toHaveLength(6);
    expect(inst.reduce((a, i) => a.add(i.principalDue), new Prisma.Decimal(0)).toString()).toBe("600000");
    expect(inst.reduce((a, i) => a.add(i.interestDue), new Prisma.Decimal(0)).toString()).toBe("60000");

    const total = await db.journalLine.aggregate({ where: { tenantId: r.tenantId }, _sum: { debit: true, credit: true } });
    expect(total._sum.debit!.toString()).toBe(total._sum.credit!.toString());
    const acct = await db.account.findFirstOrThrow({ where: { tenantId: r.tenantId, code: "1-1190" } });
    const pen = await db.journalLine.aggregate({ where: { tenantId: r.tenantId, accountId: acct.id }, _sum: { debit: true, credit: true } });
    expect(pen._sum.credit!.toString()).toBe("100000");
  });
});
