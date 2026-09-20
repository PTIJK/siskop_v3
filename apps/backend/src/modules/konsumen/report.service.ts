import { format } from "date-fns";
import { Prisma } from "@prisma/client";
import type { TokoSalesReport } from "@siskop/types";
import { db } from "../../lib/db.js";
import { resolvePeriod } from "../../lib/period.js";
import { getReadableUnitIds, resolveReadableUnitId } from "../../lib/unit-access.js";
import { assertValidPeriod } from "../reports/regulatory-service.js";
import { listOutstandingMemberCredit } from "./credit.service.js";
import type { SalesReportQueryInput } from "./report.schema.js";

const ZERO = new Prisma.Decimal(0);
const TOP_PRODUCT_LIMIT = 10;
const DATE_FORMAT = "yyyy-MM-dd";

// A stable, human order for the small fixed sets below; anything unexpected sorts last.
const PAYMENT_METHOD_ORDER = ["CASH", "TRANSFER", "MEMBER_CREDIT"];
const STOCK_TYPE_ORDER = ["IN", "OUT", "ADJUSTMENT"];

function orderIndex(order: string[], value: string): number {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}

/**
 * Operational Laporan Toko for one Toko unit — or, with no `unitId`, every unit
 * the caller may access, combined (consolidated = omit the unit filter,
 * CLAUDE.md rule 2b; a user scoped to specific units only ever sees those).
 *
 * Reads POSSale/POSSaleLine directly rather than the journal, so it works for a
 * tenant without the accounting package and shows cost/margin per product,
 * which the ledger doesn't keep. It stays in step with the ledger-derived Laba
 * Rugi (Penjualan / HPP) for the same period because both come from the same
 * `totalPrice`/`totalCost` on each sale — tests/konsumen-report.test.ts holds
 * that as a contract.
 *
 * All sums are Decimal end to end. The period defaults to the current month
 * and its upper bound is end-of-day (lib/period.ts); `persediaan` is a current
 * snapshot and `piutangAnggota` is tenant-wide — neither is period-bound.
 */
export async function getSalesReport(
  tenantId: string,
  query: SalesReportQueryInput,
  userId: string
): Promise<TokoSalesReport> {
  const { start, end } = resolvePeriod(query.from, query.to);
  assertValidPeriod(start, end);

  // Reading, not acting: a closed (inactive) Toko's sales are still real and the ledger-derived
  // Laba Rugi still counts them, so this report must too — hence the read-access helpers, which
  // (unlike resolveUnitId/getEffectiveUnitIds) don't drop inactive units. 404 for another
  // tenant's unit, 403 for one outside the caller's assignment.
  let unitIds: string[];
  let reportedUnitId: string | null = null;
  if (query.unitId) {
    reportedUnitId = await resolveReadableUnitId(tenantId, userId, query.unitId);
    unitIds = [reportedUnitId];
  } else {
    unitIds = await getReadableUnitIds(userId, tenantId);
  }

  const saleWhere = { tenantId, unitId: { in: unitIds }, soldAt: { gte: start, lte: end } };

  const [sales, lines, products, movementGroups, credit] = await Promise.all([
    db.pOSSale.findMany({
      where: saleWhere,
      select: { paymentMethod: true, totalPrice: true, totalCost: true, soldAt: true }
    }),
    // POSSaleLine has no tenantId of its own — it is scoped through its sale.
    db.pOSSaleLine.findMany({
      where: { sale: saleWhere },
      select: { productId: true, qty: true, unitCost: true, subtotal: true }
    }),
    db.product.findMany({
      where: { tenantId, unitId: { in: unitIds }, isActive: true },
      select: { stockQty: true, cost: true }
    }),
    db.stockMovement.groupBy({
      by: ["type"],
      where: { tenantId, unitId: { in: unitIds }, createdAt: { gte: start, lte: end } },
      _sum: { quantity: true },
      _count: { _all: true }
    }),
    // Same figure the Piutang Anggota screen shows — reused, not recomputed.
    listOutstandingMemberCredit(tenantId, { page: 1, limit: 1 })
  ]);

  // ── Sales: totals, payment mix, daily trend ──────────────────────────────
  let omzet = ZERO;
  let hpp = ZERO;
  const methodTotals = new Map<string, { count: number; total: Prisma.Decimal }>();
  const dayTotals = new Map<string, { omzet: Prisma.Decimal; hpp: Prisma.Decimal; count: number }>();
  for (const sale of sales) {
    omzet = omzet.plus(sale.totalPrice);
    hpp = hpp.plus(sale.totalCost);

    const method = methodTotals.get(sale.paymentMethod) ?? { count: 0, total: ZERO };
    methodTotals.set(sale.paymentMethod, { count: method.count + 1, total: method.total.plus(sale.totalPrice) });

    // Bucketed in the server's timezone, like the dashboard's monthly charts.
    const day = format(sale.soldAt, DATE_FORMAT);
    const bucket = dayTotals.get(day) ?? { omzet: ZERO, hpp: ZERO, count: 0 };
    dayTotals.set(day, {
      omzet: bucket.omzet.plus(sale.totalPrice),
      hpp: bucket.hpp.plus(sale.totalCost),
      count: bucket.count + 1
    });
  }
  const labaKotor = omzet.minus(hpp);

  // ── Lines: items sold and per-product totals ─────────────────────────────
  let itemsSold = 0;
  const productTotals = new Map<string, { quantity: number; omzet: Prisma.Decimal; hpp: Prisma.Decimal }>();
  for (const line of lines) {
    itemsSold += line.qty;
    const product = productTotals.get(line.productId) ?? { quantity: 0, omzet: ZERO, hpp: ZERO };
    productTotals.set(line.productId, {
      quantity: product.quantity + line.qty,
      omzet: product.omzet.plus(line.subtotal),
      hpp: product.hpp.plus(line.unitCost.mul(line.qty))
    });
  }
  const topProducts = [...productTotals.entries()]
    .map(([productId, totals]) => ({ productId, ...totals }))
    .sort((a, b) => b.quantity - a.quantity || b.omzet.comparedTo(a.omzet) || a.productId.localeCompare(b.productId))
    .slice(0, TOP_PRODUCT_LIMIT);
  const productInfo =
    topProducts.length > 0
      ? await db.product.findMany({
          where: { tenantId, id: { in: topProducts.map((p) => p.productId) } },
          select: { id: true, sku: true, name: true }
        })
      : [];
  const infoById = new Map(productInfo.map((p) => [p.id, p]));

  // ── Stock snapshot ───────────────────────────────────────────────────────
  const stockValue = products.reduce((sum, p) => sum.plus(p.cost.mul(p.stockQty)), ZERO);

  return {
    periode: { from: format(start, DATE_FORMAT), to: format(end, DATE_FORMAT) },
    unitId: reportedUnitId,
    ringkasan: {
      omzet: omzet.toString(),
      hpp: hpp.toString(),
      labaKotor: labaKotor.toString(),
      marginPercent: omzet.gt(0) ? labaKotor.div(omzet).mul(100).toDecimalPlaces(2).toNumber() : 0,
      transactionCount: sales.length,
      itemsSold
    },
    perMetodeBayar: [...methodTotals.entries()]
      .map(([paymentMethod, m]) => ({ paymentMethod, count: m.count, total: m.total.toString() }))
      .sort((a, b) => orderIndex(PAYMENT_METHOD_ORDER, a.paymentMethod) - orderIndex(PAYMENT_METHOD_ORDER, b.paymentMethod)),
    produkTerlaris: topProducts.map((p) => ({
      productId: p.productId,
      sku: infoById.get(p.productId)?.sku ?? "",
      name: infoById.get(p.productId)?.name ?? "(produk dihapus)",
      quantity: p.quantity,
      omzet: p.omzet.toString(),
      hpp: p.hpp.toString(),
      labaKotor: p.omzet.minus(p.hpp).toString()
    })),
    tren: [...dayTotals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, omzet: d.omzet.toString(), labaKotor: d.omzet.minus(d.hpp).toString(), count: d.count })),
    persediaan: {
      productCount: products.length,
      outOfStockCount: products.filter((p) => p.stockQty <= 0).length,
      stockValue: stockValue.toString()
    },
    mutasiStok: movementGroups
      .map((g) => ({ type: g.type, count: g._count._all, quantity: g._sum.quantity ?? 0 }))
      .sort((a, b) => orderIndex(STOCK_TYPE_ORDER, a.type) - orderIndex(STOCK_TYPE_ORDER, b.type)),
    piutangAnggota: credit.meta.totalOutstanding.toString()
  };
}
