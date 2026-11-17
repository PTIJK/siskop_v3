import { db, type TxClient } from "./db.js";
import { withoutTenantScope } from "./tenant-scope.js";

/**
 * KOP-{TENANTSLUG}-{YYYYMM}-{4-digit sequence}, e.g. KOP-DEMO-202606-0001.
 * The sequence is a count-based scan (`startsWith` the prefix), not a DB
 * sequence — races under concurrent creates within the same tenant+month are
 * not guarded, ported as-is from the pre-rescaffold system.
 */
export async function generateMemberId(tenantId: string, tenantSlug: string, tx: TxClient | typeof db = db): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `KOP-${tenantSlug.toUpperCase()}-${yearMonth}-`;

  const count = await tx.member.count({
    where: { tenantId, memberId: { startsWith: prefix } }
  });

  const sequence = String(count + 1).padStart(4, "0");
  return `${prefix}${sequence}`;
}

/**
 * ACC-{10-digit random numeric}, retried until globally unique across all
 * tenants — matches `Member.accountNumber`'s global `@unique` column.
 */
export async function generateAccountNumber(tx: TxClient | typeof db = db): Promise<string> {
  let accountNumber = "";
  let exists = true;

  while (exists) {
    const random = Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000;
    accountNumber = `ACC-${random}`;
    const found = await tx.member.findUnique({ where: { accountNumber } });
    exists = !!found;
  }

  return accountNumber;
}

/** Generate globally unique account numbers for a single bulk insert. */
export async function generateAccountNumbers(tx: TxClient, n: number): Promise<string[]> {
  const out = new Set<string>();
  while (out.size < n) {
    const batch = new Set<string>();
    while (out.size + batch.size < n) batch.add(`ACC-${Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000}`);
    const taken = await withoutTenantScope(() => tx.member.findMany({ where: { accountNumber: { in: [...batch] } }, select: { accountNumber: true } }));
    const takenSet = new Set(taken.map((t) => t.accountNumber));
    for (const a of batch) if (!takenSet.has(a) && !out.has(a)) out.add(a);
  }
  return [...out];
}
