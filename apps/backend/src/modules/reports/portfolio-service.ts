import { Prisma } from "@prisma/client";
import { PAR_BUCKETS, type CollectionEfficiency, type ParBucket, type ParLoanRow, type PortfolioPar } from "@siskop/types";
import { db } from "../../lib/db.js";
import { businessDate, dateKey } from "../../lib/operating-calendar.js";
import { assertValidPeriod } from "./regulatory-service.js";

/**
 * Loan-book quality: Portfolio at Risk (PAR), NPL, the loans behind each bucket, and how much
 * of what fell due was collected. Only ACTIVE loans are in the book (the same population the
 * dashboard's NPL uses). Everything aggregates in SQL.
 *
 * "Days past due" is Loan.daysOverdue as the daily KOL job last wrote it
 * (lib/kol.ts#recalculateAllKOL), so these figures agree with the dashboard and the KOL
 * badges instead of being a second, slightly different calculation.
 */

const D = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n);
const ZERO = () => D(0);
const money = (d: Prisma.Decimal) => d.toDecimalPlaces(2).toString();
/** part / total in percent, 2 decimals; 0 for an empty book rather than a division by zero. */
const pct = (part: Prisma.Decimal, total: Prisma.Decimal) => (total.isZero() ? "0" : part.div(total).mul(100).toDecimalPlaces(2).toString());

const BUCKET_SQL = Prisma.sql`CASE
  WHEN l."daysOverdue" <= 0 THEN 'CURRENT'
  WHEN l."daysOverdue" <= 30 THEN 'D1_30'
  WHEN l."daysOverdue" <= 60 THEN 'D31_60'
  WHEN l."daysOverdue" <= 90 THEN 'D61_90'
  ELSE 'D90_PLUS' END`;

/**
 * Principal still owed on a loan: the unpaid principal of its schedule when it has one,
 * otherwise (a loan older than the schedule feature) the remaining payable scaled by the
 * principal share of the total, the same flat split the rest of the system uses.
 */
const outstandingSql = (tenantId: string) => Prisma.sql`COALESCE(
  (SELECT SUM(i."principalDue" - i."principalPaid") FROM "LoanInstallment" i WHERE i."loanId" = l."id" AND i."tenantId" = ${tenantId}),
  l."remainingAmount" * l."principalAmount" / NULLIF(l."totalAmount", 0),
  0)`;

const activeLoans = (tenantId: string, unitId?: string) =>
  Prisma.sql`l."tenantId" = ${tenantId} AND l."status" = 'ACTIVE' ${unitId ? Prisma.sql`AND l."unitId" = ${unitId}` : Prisma.empty}`;

interface BucketRow {
  bucket: ParBucket;
  loans: number;
  outstanding: Prisma.Decimal | null;
}
interface ProductRow {
  loanConfigId: string;
  name: string;
  loans: number;
  outstanding: Prisma.Decimal | null;
  overdue30: Prisma.Decimal | null;
  overdue90: Prisma.Decimal | null;
}

export async function getPortfolioPar(tenantId: string, unitId?: string): Promise<PortfolioPar> {
  const outstanding = outstandingSql(tenantId);
  const scope = activeLoans(tenantId, unitId);

  const [bucketRows, productRows] = await Promise.all([
    db.$queryRaw<BucketRow[]>(Prisma.sql`
      SELECT bucket, COUNT(*)::int AS loans, SUM(principal) AS outstanding
      FROM (SELECT ${BUCKET_SQL} AS bucket, ${outstanding} AS principal FROM "Loan" l WHERE ${scope}) x
      GROUP BY bucket`),
    db.$queryRaw<ProductRow[]>(Prisma.sql`
      SELECT x."loanConfigId" AS "loanConfigId", c."name" AS name, COUNT(*)::int AS loans,
             SUM(x.principal) AS outstanding,
             SUM(CASE WHEN x."daysOverdue" > 30 THEN x.principal ELSE 0 END) AS overdue30,
             SUM(CASE WHEN x."daysOverdue" > 90 THEN x.principal ELSE 0 END) AS overdue90
      FROM (SELECT l."loanConfigId", l."daysOverdue", ${outstanding} AS principal FROM "Loan" l WHERE ${scope}) x
      JOIN "LoanConfig" c ON c."id" = x."loanConfigId" AND c."tenantId" = ${tenantId}
      GROUP BY x."loanConfigId", c."name"
      ORDER BY SUM(x.principal) DESC`)
  ]);

  const byBucket = new Map(bucketRows.map((r) => [r.bucket, r]));
  const total = bucketRows.reduce((s, r) => s.plus(r.outstanding ?? 0), ZERO());
  const sumFrom = (from: number) =>
    PAR_BUCKETS.slice(from).reduce((s, b) => s.plus(byBucket.get(b)?.outstanding ?? 0), ZERO());
  const over90 = sumFrom(PAR_BUCKETS.indexOf("D90_PLUS"));

  return {
    asOf: dateKey(businessDate()),
    loans: bucketRows.reduce((s, r) => s + r.loans, 0),
    totalOutstanding: money(total),
    buckets: PAR_BUCKETS.map((bucket) => {
      const row = byBucket.get(bucket);
      const amount = D(row?.outstanding ?? 0);
      return { bucket, loans: row?.loans ?? 0, outstanding: money(amount), share: pct(amount, total) };
    }),
    ratios: {
      par1: pct(sumFrom(PAR_BUCKETS.indexOf("D1_30")), total),
      par30: pct(sumFrom(PAR_BUCKETS.indexOf("D31_60")), total),
      par90: pct(over90, total)
    },
    nplRatio: pct(over90, total),
    byProduct: productRows.map((r) => {
      const out = D(r.outstanding ?? 0);
      return {
        loanConfigId: r.loanConfigId,
        name: r.name,
        loans: r.loans,
        outstanding: money(out),
        overdue30: money(D(r.overdue30 ?? 0)),
        overdue90: money(D(r.overdue90 ?? 0)),
        par30: pct(D(r.overdue30 ?? 0), out),
        par90: pct(D(r.overdue90 ?? 0), out)
      };
    })
  };
}

interface LoanListRow {
  loanId: string;
  memberName: string;
  memberCode: string;
  loanConfigName: string;
  unitId: string;
  daysOverdue: number;
  kolCategory: string;
  outstanding: Prisma.Decimal | null;
}

/** The loans behind one bucket, largest outstanding first: where a PAR figure can be traced to people. */
export async function listParLoans(
  tenantId: string,
  bucket: ParBucket,
  unitId: string | undefined,
  page: number,
  limit: number
): Promise<{ items: ParLoanRow[]; total: number }> {
  const outstanding = outstandingSql(tenantId);
  const scope = activeLoans(tenantId, unitId);

  const [rows, count] = await Promise.all([
    db.$queryRaw<LoanListRow[]>(Prisma.sql`
      SELECT l."id" AS "loanId", m."fullName" AS "memberName", m."memberId" AS "memberCode",
             c."name" AS "loanConfigName", l."unitId" AS "unitId", l."daysOverdue" AS "daysOverdue",
             l."kolCategory"::text AS "kolCategory", ${outstanding} AS outstanding
      FROM "Loan" l
      JOIN "Member" m ON m."id" = l."memberId" AND m."tenantId" = ${tenantId}
      JOIN "LoanConfig" c ON c."id" = l."loanConfigId" AND c."tenantId" = ${tenantId}
      WHERE ${scope} AND ${BUCKET_SQL} = ${bucket}
      ORDER BY outstanding DESC, l."id"
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`),
    db.$queryRaw<[{ n: number }]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM "Loan" l WHERE ${scope} AND ${BUCKET_SQL} = ${bucket}`)
  ]);

  return {
    total: count[0]?.n ?? 0,
    items: rows.map((r) => ({ ...r, outstanding: money(D(r.outstanding ?? 0)) }))
  };
}

/**
 * How much of what fell due in [from, to] has been collected: the installments due in the
 * period against what has been paid on them to date. Loans still PENDING are not collectable
 * yet and stay out; loans without a schedule cannot be measured and are only counted.
 */
export async function getCollectionEfficiency(
  tenantId: string,
  period: { start: Date; end: Date },
  unitId?: string
): Promise<CollectionEfficiency> {
  assertValidPeriod(period.start, period.end);
  const from = dateKey(businessDate(period.start));
  const to = dateKey(businessDate(period.end));
  const loanScope = unitId ? { unitId } : {};

  const [due, cash, withoutSchedule] = await Promise.all([
    db.loanInstallment.aggregate({
      where: {
        tenantId,
        dueDate: { gte: new Date(from), lte: new Date(to) },
        loan: { status: { in: ["ACTIVE", "COMPLETED"] }, ...loanScope }
      },
      _count: { _all: true },
      _sum: { principalDue: true, interestDue: true, principalPaid: true, interestPaid: true }
    }),
    db.loanPayment.aggregate({
      where: { tenantId, paidAt: { gte: period.start, lte: period.end }, loan: loanScope },
      _sum: { amount: true }
    }),
    db.loan.count({ where: { tenantId, status: "ACTIVE", installments: { none: {} }, ...loanScope } })
  ]);

  const amountDue = D(due._sum.principalDue ?? 0).plus(due._sum.interestDue ?? 0);
  const paidOnDue = D(due._sum.principalPaid ?? 0).plus(due._sum.interestPaid ?? 0);

  return {
    periode: { from, to },
    installmentsDue: due._count._all,
    amountDue: money(amountDue),
    paidOnDue: money(paidOnDue),
    efficiency: amountDue.isZero() ? null : pct(paidOnDue, amountDue),
    cashCollected: money(D(cash._sum.amount ?? 0)),
    loansWithoutSchedule: withoutSchedule
  };
}
