import { Prisma } from "@prisma/client";

/**
 * Chart-of-accounts tree helpers shared by the reports. Roll-ups come from
 * `Account.parentId`, never from hard-coded code ranges, so adding or
 * renumbering an account cannot silently break a parent total.
 *
 * Roll-ups sum raw debit/credit rather than signed balances: a parent's
 * normal-balance figure is then derived once from the summed sides, which keeps
 * contra children correct without per-child sign juggling.
 */

export interface TreeAccount {
  id: string;
  parentId: string | null;
  category: string;
  normalBalance: "DEBIT" | "KREDIT";
}

export interface DebitCredit {
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
}

const ZERO = () => new Prisma.Decimal(0);

/** The side an account of this category normally sits on. */
function naturalSide(category: string): "DEBIT" | "KREDIT" {
  return category === "ASET" || category === "BEBAN" ? "DEBIT" : "KREDIT";
}

/**
 * A contra account carries the opposite normal balance of its category: Penyisihan
 * Kerugian Piutang (credit-normal ASET), Prive (debit-normal EKUITAS), Retur
 * Penjualan (debit-normal PENDAPATAN). No stored flag: the opposite normal balance
 * *is* the definition, so it cannot drift from the data.
 */
export function isContraAccount(category: string, normalBalance: "DEBIT" | "KREDIT"): boolean {
  return normalBalance !== naturalSide(category);
}

/**
 * What an account adds to its report section. `normalBalanceAmount` is already
 * sign-adjusted by the account's own normal balance (credit-debit for a credit-
 * normal account); a contra account subtracts it from the section instead.
 */
export function reportContribution(
  category: string,
  normalBalance: "DEBIT" | "KREDIT",
  normalBalanceAmount: Prisma.Decimal
): Prisma.Decimal {
  return isContraAccount(category, normalBalance) ? normalBalanceAmount.negated() : normalBalanceAmount;
}

/** Normal-balance amount from raw sides: debit-normal = debit-credit, credit-normal = credit-debit. */
export function normalBalanceAmount(normalBalance: "DEBIT" | "KREDIT", sums: DebitCredit): Prisma.Decimal {
  return normalBalance === "DEBIT" ? sums.debit.minus(sums.credit) : sums.credit.minus(sums.debit);
}

/** Depth per account id: roots are 1. A parent cycle terminates instead of looping. */
export function accountLevels(accounts: TreeAccount[]): Map<string, number> {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const levels = new Map<string, number>();
  for (const account of accounts) {
    let depth = 1;
    const seen = new Set<string>([account.id]);
    let parentId = account.parentId;
    while (parentId && byId.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId);
      depth++;
      parentId = byId.get(parentId)!.parentId;
    }
    levels.set(account.id, depth);
  }
  return levels;
}

/**
 * Depth-first order for display: parent, then its children (siblings by code).
 * Orphans (parent not in the list) are treated as roots, and accounts caught in
 * a parent cycle are appended last, so nothing is ever dropped from a report.
 */
export function orderDepthFirst<T extends TreeAccount & { code: string }>(accounts: T[]): T[] {
  const ids = new Set(accounts.map((a) => a.id));
  const byParent = new Map<string | null, T[]>();
  for (const a of accounts) {
    const key = a.parentId && ids.has(a.parentId) ? a.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), a]);
  }
  for (const list of byParent.values()) list.sort((x, y) => x.code.localeCompare(y.code));

  const out: T[] = [];
  const visited = new Set<string>();
  const visit = (a: T) => {
    if (visited.has(a.id)) return;
    visited.add(a.id);
    out.push(a);
    for (const child of byParent.get(a.id) ?? []) visit(child);
  };
  for (const root of byParent.get(null) ?? []) visit(root);
  for (const a of accounts) visit(a); // cycle members
  return out;
}

/** Each account's own sums plus those of all its descendants. Accounts with no postings get zero. */
export function rollUpSums(accounts: TreeAccount[], own: Map<string, DebitCredit>): Map<string, DebitCredit> {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const rolled = new Map<string, DebitCredit>(accounts.map((a) => [a.id, { debit: ZERO(), credit: ZERO() }]));

  for (const account of accounts) {
    const sums = own.get(account.id);
    if (!sums) continue;
    const seen = new Set<string>();
    let cursor: TreeAccount | undefined = account;
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      const target = rolled.get(cursor.id)!;
      target.debit = target.debit.plus(sums.debit);
      target.credit = target.credit.plus(sums.credit);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
  }
  return rolled;
}
