import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { endOfMonth, startOfMonth } from "date-fns";
import { db } from "../src/lib/db.js";
import { getGrowthDashboard } from "../src/modules/dashboard/service.js";
import { createMemberAs, setupTenant } from "./helpers.js";

beforeAll(() => { process.env.JWT_SECRET = "test-secret"; process.env.JWT_REFRESH_SECRET = "test-refresh-secret"; });
beforeEach(async () => { await db.tenant.deleteMany({}); });

describe("dashboard growth aggregation", () => {
  it("includes month boundaries and scopes members and transactions by tenant and unit", async () => {
    const a = await setupTenant();
    const b = await setupTenant({ slug: "other", registrationNo: "OTHER" });
    const tenantId = a.user.tenantId;
    const first = await createMemberAs(a.accessToken, { nik: "1111111111111111" });
    const second = await createMemberAs(a.accessToken, { nik: "2222222222222222" });
    const foreign = await createMemberAs(b.accessToken, { nik: "3333333333333333" });
    const unit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId } });
    const otherUnit = await db.cooperativeUnit.create({ data: { tenantId, name: "Other", type: "KSP" } });
    const foreignUnit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: b.user.tenantId } });
    await db.unitMembership.deleteMany({ where: { memberId: second.id } });
    await db.unitMembership.create({ data: { memberId: second.id, unitId: otherUnit.id } });
    const cfg = await db.savingConfig.create({ data: { tenantId, name: "Sukarela", type: "SUKARELA", rateType: "BUNGA", rate: 0, periodUnit: "MONTHLY" } });
    const cfgB = await db.savingConfig.create({ data: { tenantId: b.user.tenantId, name: "Sukarela", type: "SUKARELA", rateType: "BUNGA", rate: 0, periodUnit: "MONTHLY" } });
    const saving = await db.saving.create({ data: { tenantId, unitId: unit.id, memberId: first.id, savingConfigId: cfg.id } });
    const savingOther = await db.saving.create({ data: { tenantId, unitId: otherUnit.id, memberId: second.id, savingConfigId: cfg.id } });
    const savingForeign = await db.saving.create({ data: { tenantId: b.user.tenantId, unitId: foreignUnit.id, memberId: foreign.id, savingConfigId: cfgB.id } });
    await db.savingTransaction.createMany({ data: [
      { tenantId, savingId: saving.id, type: "DEPOSIT", amount: 100, createdAt: startOfMonth(new Date()) },
      { tenantId, savingId: savingOther.id, type: "WITHDRAWAL", amount: 30, createdAt: endOfMonth(new Date()) },
      { tenantId: b.user.tenantId, savingId: savingForeign.id, type: "DEPOSIT", amount: 900, createdAt: new Date() }
    ] });
    const loanConfig = await db.loanConfig.create({ data: { tenantId, name: "Test loan", type: "KONVENSIONAL", rateType: "BUNGA", rate: 0, maxTermMonths: 12 } });
    const foreignLoanConfig = await db.loanConfig.create({ data: { tenantId: b.user.tenantId, name: "Other loan", type: "KONVENSIONAL", rateType: "BUNGA", rate: 0, maxTermMonths: 12 } });
    const loan = await db.loan.create({ data: { tenantId, unitId: unit.id, memberId: first.id, loanConfigId: loanConfig.id, principalAmount: 100, totalAmount: 100, termMonths: 1, monthlyPayment: 100, remainingAmount: 100, disbursedAt: startOfMonth(new Date()) } });
    const otherLoan = await db.loan.create({ data: { tenantId, unitId: otherUnit.id, memberId: second.id, loanConfigId: loanConfig.id, principalAmount: 200, totalAmount: 200, termMonths: 1, monthlyPayment: 200, remainingAmount: 200, disbursedAt: endOfMonth(new Date()) } });
    const foreignLoan = await db.loan.create({ data: { tenantId: b.user.tenantId, unitId: foreignUnit.id, memberId: foreign.id, loanConfigId: foreignLoanConfig.id, principalAmount: 900, totalAmount: 900, termMonths: 1, monthlyPayment: 900, remainingAmount: 900, disbursedAt: new Date() } });
    await db.loanPayment.createMany({ data: [
      { tenantId, loanId: loan.id, amount: 10, paidAt: startOfMonth(new Date()), createdBy: a.user.id },
      { tenantId, loanId: otherLoan.id, amount: 20, paidAt: endOfMonth(new Date()), createdBy: a.user.id },
      { tenantId: b.user.tenantId, loanId: foreignLoan.id, amount: 900, paidAt: new Date(), createdBy: b.user.id }
    ] });
    expect((await getGrowthDashboard(tenantId)).at(-1)).toMatchObject({ newMembers: 2, savingsNetFlow: "70", disbursement: "300", repayment: "30" });
    expect((await getGrowthDashboard(tenantId, unit.id)).at(-1)).toMatchObject({ newMembers: 1, savingsNetFlow: "100", disbursement: "100", repayment: "10" });
  });
});
