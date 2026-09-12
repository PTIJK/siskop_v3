import { Prisma } from "@prisma/client";
import { ErrorCode } from "@siskop/types";
import type { CreateSaleResponse, PosSaleListItem } from "@siskop/types";
import { db } from "../../lib/db.js";
import { AppError, notFound, validationError } from "../../lib/errors.js";
import { postPosSale } from "../../lib/journal.js";
import { resolveUnitId } from "../../lib/units.js";
import { assertUnitAccess } from "../../lib/unit-access.js";
import { getMemberCreditStatus } from "./credit.service.js";
import type { CreateSaleInput, ListSalesQueryInput } from "./sale.schema.js";

const OUT_REASON = "Penjualan POS";

/**
 * Atomically: validates every line's stock, decrements `Product.stockQty`,
 * writes one `StockMovement` (`OUT`) row per line, inserts `POSSale` +
 * `POSSaleLine`, then posts the balanced double-entry journal entry via
 * `postPosSale()` — all inside one `db.$transaction`, so an insufficient-
 * stock failure rolls back everything, journal entry included.
 *
 * Deliberately does NOT call `product.service.ts#recordStockMovement()`:
 * that function opens its own `db.$transaction` internally, so calling it
 * from inside this one would not share this transaction's connection/
 * rollback scope (a failure on a later line would leave an earlier line's
 * stock movement committed). The stock-decrement + StockMovement write below
 * mirrors that function's DB-writing logic instead of sharing it.
 */
export async function createSale(
  tenantId: string,
  data: CreateSaleInput,
  createdBy: string
): Promise<CreateSaleResponse> {
  const unitId = await resolveUnitId(tenantId, data.unitId);
  await assertUnitAccess(createdBy, tenantId, unitId);

  // Eligibility is checked before the transaction (same "validate, then
  // mutate" ordering loans/service.ts#createLoan uses for hasPokokSaving),
  // using a preliminary price lookup — the transaction below re-validates
  // stock/price and computes the authoritative totalPrice regardless, so a
  // price/stock change in between is caught there, not silently accepted.
  // Zod's schema-level refine already guarantees memberId is present here.
  if (data.paymentMethod === "MEMBER_CREDIT") {
    const products = await db.product.findMany({
      where: { tenantId, unitId, id: { in: data.items.map((item) => item.productId) } }
    });
    const estimatedTotal = data.items.reduce((sum, item) => {
      const product = products.find((p) => p.id === item.productId);
      return product ? sum.add(product.price.mul(item.quantity)) : sum;
    }, new Prisma.Decimal(0));

    const status = await getMemberCreditStatus(tenantId, data.memberId!);
    if (!status.hasActiveSaving) {
      throw new AppError(ErrorCode.MEMBER_HAS_NO_ACTIVE_SAVING, "Anggota belum memiliki simpanan aktif");
    }
    if (status.availableCredit.lt(estimatedTotal)) {
      throw new AppError(ErrorCode.MEMBER_CREDIT_LIMIT_EXCEEDED, "Limit kredit anggota tidak mencukupi");
    }
  }

  return db.$transaction(async (tx) => {
    // memberId is optional (Toko serves walk-in non-members too, unlike
    // Saving/Loan — see schema.prisma's POSSale.memberId comment), but when
    // supplied it must be validated against the caller's own tenant first —
    // never trust a client-supplied id to reference another tenant's row
    // (CLAUDE.md rule 1), mirroring loans/service.ts#createLoan's member check.
    let memberId: string | null = null;
    if (data.memberId) {
      const member = await tx.member.findFirst({ where: { id: data.memberId, tenantId } });
      if (!member) throw notFound("Anggota tidak ditemukan");
      memberId = member.id;
    }

    let totalPrice = new Prisma.Decimal(0);
    let totalCost = new Prisma.Decimal(0);

    const lines: {
      productId: string;
      quantity: number;
      stockQtyBefore: number;
      unitPrice: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      subtotal: Prisma.Decimal;
    }[] = [];

    // Validate every line (existence + sufficient stock) before writing
    // anything, so an insufficient-stock line never leaves an earlier line's
    // stock partially decremented — the whole transaction simply never
    // reaches a write.
    for (const item of data.items) {
      const product = await tx.product.findFirst({ where: { id: item.productId, tenantId, unitId } });
      if (!product) throw notFound(`Produk ${item.productId} tidak ditemukan`);
      if (product.stockQty < item.quantity) {
        throw validationError(
          `Stok ${product.name} tidak mencukupi (tersedia ${product.stockQty}, diminta ${item.quantity})`
        );
      }

      const subtotal = product.price.mul(item.quantity);
      const lineCost = product.cost.mul(item.quantity);
      totalPrice = totalPrice.add(subtotal);
      totalCost = totalCost.add(lineCost);

      lines.push({
        productId: product.id,
        quantity: item.quantity,
        stockQtyBefore: product.stockQty,
        unitPrice: product.price,
        unitCost: product.cost,
        subtotal
      });
    }

    for (const line of lines) {
      await tx.stockMovement.create({
        data: {
          tenantId,
          unitId,
          productId: line.productId,
          type: "OUT",
          quantity: line.quantity,
          reason: OUT_REASON,
          createdBy
        }
      });
      await tx.product.update({
        where: { id: line.productId, tenantId },
        data: { stockQty: line.stockQtyBefore - line.quantity }
      });
    }

    const soldAt = new Date();
    const sale = await tx.pOSSale.create({
      data: {
        tenantId,
        unitId,
        memberId,
        paymentMethod: data.paymentMethod,
        totalPrice,
        totalCost,
        soldAt,
        createdBy
      }
    });

    await tx.pOSSaleLine.createMany({
      data: lines.map((line) => ({
        saleId: sale.id,
        productId: line.productId,
        qty: line.quantity,
        unitPrice: line.unitPrice,
        unitCost: line.unitCost,
        subtotal: line.subtotal
      }))
    });

    await postPosSale(tx, {
      tenantId,
      saleId: sale.id,
      paymentMethod: data.paymentMethod,
      totalPrice: totalPrice.toNumber(),
      totalCost: totalCost.toNumber(),
      entryDate: soldAt,
      description: "Penjualan POS"
    });

    return { id: sale.id, totalAmount: totalPrice.toString() };
  });
}

export async function listSales(
  tenantId: string,
  query: ListSalesQueryInput,
  userId: string
): Promise<PosSaleListItem[]> {
  const unitId = await resolveUnitId(tenantId, query.unitId);
  await assertUnitAccess(userId, tenantId, unitId);

  const sales = await db.pOSSale.findMany({
    where: { tenantId, unitId },
    include: { _count: { select: { lines: true } } },
    orderBy: { soldAt: "desc" }
  });

  return sales.map((sale) => ({
    id: sale.id,
    totalAmount: sale.totalPrice.toString(),
    paymentMethod: sale.paymentMethod,
    memberId: sale.memberId,
    soldAt: sale.soldAt.toISOString(),
    lineCount: sale._count.lines
  }));
}
