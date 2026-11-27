import ExcelJS from "exceljs";
import request from "supertest";
import { expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { testDatabaseUrl } from "./database-isolation.js";
import { app, setupTenant } from "./helpers.js";

it("reviews and applies verified members, savings and loan openings once, with balanced journals", async () => {
  testDatabaseUrl(process.env.DATABASE_URL ?? "");
  const slug = "excel-apply-test";
  const admin = await setupTenant({ slug, registrationNo: slug, adminEmail: slug + "@example.test" });
  const tenantId = admin.user.tenantId;
  try {
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId } });
    const accounts = await Promise.all([
      db.account.create({ data: { tenantId, code: "3-9900", name: "Penampung uji", category: "EKUITAS", normalBalance: "KREDIT" } }),
      db.account.create({ data: { tenantId, code: "2-9900", name: "Simpanan uji", category: "KEWAJIBAN", normalBalance: "KREDIT" } }),
      db.account.create({ data: { tenantId, code: "1-9900", name: "Piutang uji", category: "ASET", normalBalance: "DEBIT" } }),
      db.account.create({ data: { tenantId, code: "4-9900", name: "Margin uji", category: "PENDAPATAN", normalBalance: "KREDIT" } })
    ]);
    const [offset, savingAccount, loanAccount, marginAccount] = accounts as [typeof accounts[number], typeof accounts[number], typeof accounts[number], typeof accounts[number]];
    const savings = await db.savingConfig.create({ data: { tenantId, name: "Simpanan Pokok + Wajib", type: "POKOK_WAJIB", rateType: "BUNGA", rate: 0, periodUnit: "YEARLY" } });
    const loan = await db.loanConfig.create({ data: { tenantId, name: "Pinjaman Uji", type: "KONVENSIONAL", rateType: "BUNGA", rate: 5, maxTermMonths: 24 } });
    await db.accountMapping.createMany({ data: [
      { tenantId, sourceType: "SAVING_CONFIG", sourceId: savings.id, transactionKind: "DEPOSIT", debitAccountId: offset.id, creditAccountId: savingAccount.id },
      { tenantId, sourceType: "LOAN_CONFIG", sourceId: loan.id, transactionKind: "DISBURSEMENT", debitAccountId: loanAccount.id, creditAccountId: offset.id },
      { tenantId, sourceType: "LOAN_CONFIG", sourceId: loan.id, transactionKind: "PAYMENT_PRINCIPAL", debitAccountId: offset.id, creditAccountId: loanAccount.id },
      { tenantId, sourceType: "LOAN_CONFIG", sourceId: loan.id, transactionKind: "PAYMENT_INTEREST", debitAccountId: offset.id, creditAccountId: marginAccount.id }
    ] });
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Anggota").addRows([
      ["No Anggota", "Nama", "NIK", "Alamat", "Tempat Lahir", "Tanggal Lahir", "Pekerjaan"],
      ["398", "Anggota Uji", undefined, "Jalan Uji Nomor 11", "Surabaya", "1995-03-04", "Guru"],
      ["399", "Identitas belum lengkap"]
    ]);
    workbook.addWorksheet("Simpanan").addRows([
      ["PER 28 FEBRUARI 2025"],
      ["No Anggota", "Nama", "Total Simpanan Pokok & Wajib"], ["398", "Anggota Uji", 5910000]
    ]);
    workbook.addWorksheet("Pinjaman").addRows([
      ["Nama", "No Anggota", "loanRef", "productCode", "principalAmount", "totalAmount", "remainingPrincipal", "remainingAmount", "disbursedAt", "termMonths", "rate", "installmentAmount"],
      ["Anggota Uji", "398", "K-1", "Pinjaman Uji", 200000, 220000, 100000, 110000, "2025-01-01", 2, 5, 110000],
      ["Anggota Uji", "398", "K-2", "Pinjaman Uji", 500000, 550000, 100000, 110000, "2025-02-01", 2, 5, 110000]
    ]);
    workbook.addWorksheet("Jadwal Angsuran").addRows([
      ["loanRef", "dueDate", "principalDue", "interestDue"], ["K-1", "2025-03-01", 100000, 10000]
    ]);

    const server = app();
    const auth = (req: request.Test) => req.auth(admin.accessToken, { type: "bearer" });
    const url = "/api/excel-imports";
    const uploaded = await auth(request(server).post(url)).attach("file", Buffer.from(await workbook.xlsx.writeBuffer()), "uji.xlsx");
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(200);
    const endpoint = url + "/" + uploaded.body.data.id + "/apply";
    const member = { group: "anggota", unitId: unit.id };
    const saving = { group: "simpanan", unitId: unit.id, cutoffDate: "2025-02-28" };
    const finance = { ...saving, group: "pinjaman" };
    const preview = async (settings: object) => {
      const res = await auth(request(server).post(endpoint + "/preview")).send(settings);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data;
    };
    const apply = (settings: object, token: string) => auth(request(server).post(endpoint + "/commit")).send({ settings, token });
    const blockedSaving = await preview(saving);
    expect(blockedSaving.ready).toBe(0);
    const memberFix = blockedSaving.items[0].fix;
    expect(memberFix.kind).toBe("member");
    const correctionPath = endpoint + "/corrections/" + memberFix.group + "/" + memberFix.index;
    const rowKey = { unitId: unit.id, basis: memberFix.basis };
    const detail = await auth(request(server).get(correctionPath)).query(rowKey);
    expect(detail.body.data).toMatchObject({ identity: { fullName: "Anggota Uji", nik: "" }, source: { memberNumber: "398" } });
    expect(detail.body.data.related.anggota).toHaveLength(1);
    expect(detail.body.data.related.simpanan).toHaveLength(1);
    expect(detail.body.data.related.pinjaman.map((row: { label: string }) => row.label)).toEqual(["K-1", "K-2"]);
    const entry = detail.body.data.savingEntries[0];
    expect(entry).toMatchObject({ label: "Simpanan Pokok + Wajib", amount: "5910000" });
    expect((await auth(request(server).post(correctionPath)).send({ ...rowKey, revision: detail.body.data.revision,
      slot: entry.slot, correction: { kind: "saving", amount: "5920000" } })).status).toBe(200);
    expect((await preview(saving)).ready).toBe(0);
    const refreshed = await auth(request(server).get(correctionPath)).query(rowKey);
    expect(refreshed.body.data.savingEntries[0].amount).toBe("5920000");
    const correction = { ...rowKey, revision: refreshed.body.data.revision, correction: { kind: "member", member: { mode: "identity",
      identity: { ...detail.body.data.identity, nik: "1234567890123456" } } } };
    expect((await auth(request(server).post(correctionPath)).send(correction)).status).toBe(200);
    expect((await auth(request(server).post(correctionPath)).send(correction)).status).toBe(409);
    const memberReview = await preview(member);
    expect(memberReview.items.map((item: { status: string }) => item.status)).toEqual(["ready", "review"]);
    expect(await db.member.count({ where: { tenantId } })).toBe(0);
    expect((await apply(saving, memberReview.token)).status).toBe(409);
    const added = await apply(member, memberReview.token);
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    expect((await apply(member, memberReview.token)).body.data.id).toBe(added.body.data.id);
    expect(await db.member.count({ where: { tenantId } })).toBe(1);
    const memberSearch = await auth(request(server).get(endpoint + "/member-candidates")).query({ unitId: unit.id, q: "Anggota Uji" });
    expect(memberSearch.body.data).toMatchObject([{ fullName: "Anggota Uji" }]);
    expect((await preview(member)).items[0].status).toBe("existing");
    expect((await auth(request(server).get(endpoint))).body.data.balanceDates).toEqual({ simpanan: "2025-02-28" });
    const missingDate = await preview({ group: "simpanan", unitId: unit.id });
    expect(missingDate.ready).toBe(1);
    expect(missingDate.token).toBeUndefined();
    expect(missingDate.postingIssue).toContain("Isi tanggal saldo");
    const savingReview = await preview(saving);
    expect(savingReview).toMatchObject({ ready: 1, total: "5920000.00" });
    const saved = await apply(saving, savingReview.token);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await apply(saving, savingReview.token)).body.data.id).toBe(saved.body.data.id);
    expect(await db.saving.count({ where: { tenantId } })).toBe(1);
    const loanReview = await preview(finance);
    expect(loanReview).toMatchObject({ ready: 1, total: "100000.00" });
    expect(loanReview.items.some((item: { status: string }) => item.status === "review")).toBe(true);
    const opened = await apply(finance, loanReview.token);
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    const loanFix = (await preview(finance)).items.find((item: { status: string }) => item.status === "review").fix;
    const loanPath = endpoint + "/corrections/" + loanFix.group + "/" + loanFix.index;
    const loanKeys = { unitId: unit.id, basis: loanFix.basis, slot: loanFix.slot };
    const loanDetail = (await auth(request(server).get(loanPath)).query(loanKeys)).body.data;
    const loanCorrection = await auth(request(server).post(loanPath)).send({
      ...loanKeys, cutoffDate: finance.cutoffDate, revision: loanDetail.revision,
      correction: { kind: "loan", productId: loan.id, contract: { ...loanDetail.contract,
        schedule: [{ dueDate: "2025-03-01", principal: "100000", margin: "10000" }] } }
    });
    expect(loanCorrection.status, JSON.stringify(loanCorrection.body)).toBe(200);
    expect((await preview(finance)).ready).toBe(1);
    expect(await db.loan.count({ where: { tenantId } })).toBe(1);
    expect(await db.loanInstallment.count({ where: { tenantId } })).toBe(1);
    const journals = await db.journalEntry.findMany({ where: { tenantId, description: "Saldo awal impor Excel" }, include: { lines: true } });
    expect(journals).toHaveLength(2);
    const opening = await db.account.findFirstOrThrow({ where: { tenantId, name: "Saldo Awal Impor Excel" } });
    expect(opening.category).toBe("EKUITAS");
    for (const journal of journals) {
      expect(journal.lines).toHaveLength(2);
      expect(journal.lines.some((line) => line.accountId === opening.id)).toBe(true);
      expect(journal.lines.reduce((sum, line) => sum + Number(line.debit) - Number(line.credit), 0)).toBe(0);
    }
    expect((await auth(request(server).get(endpoint))).body.data.receipts).toHaveLength(3);
  } finally {
    await db.tenant.delete({ where: { id: tenantId } });
  }
});
