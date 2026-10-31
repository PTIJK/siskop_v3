import { Prisma } from "@prisma/client";

export interface OpeningLine {
  key: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
}

/**
 * Both maps are net balances per account (debit minus credit). The migration posts only
 * target - auto, so what the saving/loan postings already wrote is never counted twice.
 */
export function openingLines(target: Map<string, Prisma.Decimal>, auto: Map<string, Prisma.Decimal>): OpeningLine[] {
  const keys = new Set([...target.keys(), ...auto.keys()]);
  const lines: OpeningLine[] = [];
  let sum = new Prisma.Decimal(0);
  for (const key of [...keys].sort()) {
    const delta = (target.get(key) ?? new Prisma.Decimal(0)).sub(auto.get(key) ?? new Prisma.Decimal(0));
    if (delta.isZero()) continue;
    sum = sum.add(delta);
    lines.push({
      key,
      debit: delta.gt(0) ? delta : new Prisma.Decimal(0),
      credit: delta.lt(0) ? delta.neg() : new Prisma.Decimal(0)
    });
  }
  if (!sum.isZero()) throw new Error(`Jurnal saldo awal tidak seimbang (selisih ${sum})`);
  return lines;
}
