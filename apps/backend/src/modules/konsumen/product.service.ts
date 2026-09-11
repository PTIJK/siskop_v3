import type { Prisma } from "@prisma/client";
import { CooperativeType, type Product as ProductDTO, type StockMovement as StockMovementDTO } from "@siskop/types";
import { db } from "../../lib/db.js";
import { conflict, notFound, validationError } from "../../lib/errors.js";
import { resolveUnitId } from "../../lib/units.js";
import { assertUnitAccess } from "../../lib/unit-access.js";
import type {
  CreateProductInput,
  ListProductsQueryInput,
  ListStockMovementsQueryInput,
  RecordStockMovementInput
} from "./product.schema.js";

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  uom: string;
  price: Prisma.Decimal;
  cost: Prisma.Decimal;
  stockQty: number;
  isActive: boolean;
};

function toProductDTO(product: ProductRow): ProductDTO {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    category: product.category,
    uom: product.uom,
    sellPrice: product.price.toString(),
    costPrice: product.cost.toString(),
    stockLevel: String(product.stockQty),
    isActive: product.isActive
  };
}

export async function listProducts(
  tenantId: string,
  query: ListProductsQueryInput,
  userId: string
): Promise<ProductDTO[]> {
  const unitId = await resolveUnitId(tenantId, query.unitId);
  await assertUnitAccess(userId, tenantId, unitId);

  const products = await db.product.findMany({
    where: { tenantId, unitId, isActive: true },
    orderBy: { name: "asc" }
  });

  return products.map(toProductDTO);
}

export async function createProduct(tenantId: string, data: CreateProductInput, userId: string): Promise<ProductDTO> {
  const unitId = await resolveUnitId(tenantId, data.unitId);
  await assertUnitAccess(userId, tenantId, unitId);

  // resolveUnitId already proved this unit belongs to tenantId and is
  // active; findUniqueOrThrow (not tenant-scope-guarded, see lib/tenant-scope.ts)
  // just fetches the rest of the row so `.type` can be checked below.
  const unit = await db.cooperativeUnit.findUniqueOrThrow({ where: { id: unitId } });
  if (unit.type !== CooperativeType.KONSUMEN) {
    throw validationError("Produk hanya dapat dibuat untuk unit bertipe Konsumen/Toko");
  }

  const duplicate = await db.product.findFirst({ where: { tenantId, unitId, sku: data.sku } });
  if (duplicate) throw conflict(`SKU ${data.sku} sudah digunakan pada unit ini`);

  const product = await db.product.create({
    data: {
      tenantId,
      unitId,
      sku: data.sku,
      name: data.name,
      category: data.category ?? null,
      uom: data.uom ?? "pcs",
      price: data.sellPrice,
      cost: data.costPrice,
      stockQty: 0
    }
  });

  return toProductDTO(product);
}

/**
 * `IN` adds `quantity` to the current stock; `ADJUSTMENT` **sets** stockQty
 * to `quantity` directly — it's a correction to the true count (e.g. after a
 * physical stock-take), not a delta on top of the current one. Easy to get
 * backwards, so this exact semantic is locked by a test.
 */
export async function recordStockMovement(
  tenantId: string,
  productId: string,
  data: RecordStockMovementInput,
  createdBy: string
): Promise<ProductDTO> {
  const product = await db.product.findFirst({ where: { id: productId, tenantId } });
  if (!product) throw notFound("Produk tidak ditemukan");
  await assertUnitAccess(createdBy, tenantId, product.unitId);

  const newStockQty = data.type === "IN" ? product.stockQty + data.quantity : data.quantity;

  const updated = await db.$transaction(async (tx) => {
    await tx.stockMovement.create({
      data: {
        tenantId,
        unitId: product.unitId,
        productId: product.id,
        type: data.type,
        quantity: data.quantity,
        reason: data.reason,
        createdBy
      }
    });

    return tx.product.update({
      where: { id: product.id, tenantId },
      data: { stockQty: newStockQty }
    });
  });

  return toProductDTO(updated);
}

export async function listStockMovements(
  tenantId: string,
  query: ListStockMovementsQueryInput,
  userId: string
): Promise<StockMovementDTO[]> {
  const unitId = await resolveUnitId(tenantId, query.unitId);
  await assertUnitAccess(userId, tenantId, unitId);

  const movements = await db.stockMovement.findMany({
    where: { tenantId, unitId },
    include: { product: { select: { name: true } } },
    orderBy: { createdAt: "desc" }
  });

  return movements.map((m) => ({
    id: m.id,
    productId: m.productId,
    productName: m.product.name,
    type: m.type,
    quantity: m.quantity,
    reason: m.reason,
    createdAt: m.createdAt.toISOString()
  }));
}
