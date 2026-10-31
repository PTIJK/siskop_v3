import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { getDefaultUnitId } from "../src/lib/units.js";
import { runMigration } from "../src/modules/migration/importer.js";
import { parseRows } from "../src/modules/migration/rows.js";
import { validateData } from "../src/modules/migration/validate.js";
import { readWorkbook } from "../src/modules/migration/workbook.js";
import { ANGGOTA, fixtureWorkbook, KOPERASI, PINJAMAN, SIMPANAN_POKOK, UNIT } from "./migration-fixtures.js";

const NIK1 = "3578012345670001";
const NIK2 = "3578012345670002";

async function parsed(mode: "SISTEM" | "LAPORAN", rows: Record<string, Record<string, string | number | null>[]>) {
  const p = parseRows(await readWorkbook(await fixtureWorkbook(mode, rows)));
  expect(validateData(p.data!).issues.filter((i) => i.severity === "error")).toEqual([]);
  return p.data!;
}
const identity = () => ({ id: randomUUID(), email: "admin@koperasi-uji.test", passwordHash: "x", firebaseUid: null, authProvider: null });
const run = (data: Awaited<ReturnType<typeof parsed>>) =>
  db.$transaction((tx) => runMigration(tx, data, { identity: identity(), requestId: "t", actorUserId: null }), { timeout: 60_000 });

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

describe("runMigration (SISTEM)", () => {
  it("creates tenant, members, savings, loan and one balanced opening entry", async () => {
    const data = await parsed("SISTEM", {
      "1_Koperasi": [KOPERASI],
      "2_Unit": [UNIT],
      "4_Produk_Simpanan": [SIMPANAN_POKOK],
      "6_Produk_Pinjaman": [PINJAMAN],
      "3_Anggota": [ANGGOTA(NIK1, "Siti"), ANGGOTA(NIK2, "Budi")],
      "5_Saldo_Simpanan": [
        { nik: NIK1, productCode: "SP", balance: 500000 },
        { nik: NIK2, productCode: "SP", balance: 500000 }
      ],
      "7_Pinjaman": [
        {
          loanRef: "L-1",
          nik: NIK1,
          productCode: "PJ",
          principalAmount: 6000000,
          totalAmount: 6720000,
          remainingAmount: 3360000,
          remainingPrincipal: 3000000,
          termMonths: 12,
          installmentAmount: 560000,
          disbursedAt: "2025-07-01"
        }
      ],
      "9_Saldo_Awal_Jurnal": [
        { accountCode: "1-1000", debit: 2000000 },
        { accountCode: "1-1100", debit: 3000000 },
        { accountCode: "3-1000", credit: 1000000 },
        { accountCode: "3-2000", credit: 4000000 }
      ]
    });
    const result = await run(data);

    const tenantId = result.tenantId;
    expect(await db.member.count({ where: { tenantId } })).toBe(2);
    expect(await db.saving.count({ where: { tenantId } })).toBe(2);
    expect(await db.loanInstallment.count({ where: { tenantId } })).toBeGreaterThan(0);

    const loan = await db.loan.findFirstOrThrow({ where: { tenantId } });
    expect(loan.remainingAmount.toString()).toBe("3360000");
    expect(loan.status).toBe("ACTIVE");

    // Trial balance in the ledger now equals the sheet, per account, and debit == credit overall.
    const lines = await db.journalLine.groupBy({ by: ["accountId"], where: { tenantId }, _sum: { debit: true, credit: true } });
    const accounts = await db.account.findMany({ where: { tenantId } });
    const net = (code: string) => {
      const a = accounts.find((x) => x.code === code)!;
      const l = lines.find((x) => x.accountId === a.id);
      return new Prisma.Decimal(l?._sum.debit ?? 0).sub(l?._sum.credit ?? 0).toString();
    };
    expect(net("1-1000")).toBe("2000000");
    expect(net("1-1100")).toBe("3000000");
    expect(net("3-1000")).toBe("-1000000");
    expect(net("3-2000")).toBe("-4000000");
    const total = await db.journalLine.aggregate({ where: { tenantId }, _sum: { debit: true, credit: true } });
    expect(total._sum.debit!.toString()).toBe(total._sum.credit!.toString());
  });

  it("makes the first sheet-2 unit the default unit", async () => {
    const data = await parsed("SISTEM", {
      "1_Koperasi": [KOPERASI],
      "2_Unit": [UNIT, { unitCode: "U2", type: "KONSUMEN", name: "Toko" }],
      "4_Produk_Simpanan": [SIMPANAN_POKOK],
      "6_Produk_Pinjaman": [PINJAMAN],
      "3_Anggota": [ANGGOTA(NIK1, "Siti")],
      "9_Saldo_Awal_Jurnal": [
        { accountCode: "1-1000", debit: 1 },
        { accountCode: "3-1000", credit: 1 }
      ]
    });
    const r = await run(data);
    const def = await db.cooperativeUnit.findUniqueOrThrow({ where: { id: await getDefaultUnitId(r.tenantId) } });
    expect(def.name).toBe("Simpan Pinjam");
  });
});
