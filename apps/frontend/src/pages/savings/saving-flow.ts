import { digitsToNumber } from "@/lib/money-input";
import { formatRupiah } from "@/lib/format";

export type FlowMode = "setor" | "tarik";

export interface AccountOption {
  id: string;
  name: string;
  type: string;
  /** Decimal as a string, straight from the API. */
  balance: string;
}

export const QUICK_AMOUNTS = [50_000, 100_000, 250_000, 500_000] as const;

export const MODE_LABEL: Record<FlowMode, { noun: string; verb: string; posted: string }> = {
  setor: { noun: "Setoran", verb: "Setor", posted: "Setoran berhasil diposting" },
  tarik: { noun: "Penarikan", verb: "Tarik", posted: "Penarikan berhasil diposting" }
};

/**
 * Which account to preselect so the teller does not have to choose: a deposit
 * goes to the sukarela account first; a withdrawal needs a balance to take from
 * and avoids simpanan pokok, which cannot be withdrawn while a loan is active.
 */
export function defaultAccountId(accounts: readonly AccountOption[], mode: FlowMode): string | null {
  if (accounts.length === 0) return null;
  const rank = (type: string) => ["SUKARELA", "WAJIB", "POKOK"].indexOf(type);
  const ordered = [...accounts].sort((a, b) => {
    const ra = rank(a.type) === -1 ? 9 : rank(a.type);
    const rb = rank(b.type) === -1 ? 9 : rank(b.type);
    return ra - rb;
  });
  if (mode === "tarik") {
    const withBalance = ordered.find((a) => a.type !== "POKOK" && Number(a.balance) > 0);
    if (withBalance) return withBalance.id;
  }
  return ordered[0]?.id ?? null;
}

/** Inline validation for the amount field; undefined means nothing to say (yet, or fine). */
export function validateAmount(mode: FlowMode, digits: string, balance: number): string | undefined {
  if (digits === "") return undefined;
  const amount = digitsToNumber(digits);
  if (amount <= 0) return "Nominal harus lebih dari nol.";
  if (mode === "tarik" && amount > balance) return `Saldo tidak cukup. Saldo rekening ${formatRupiah(balance)}.`;
  return undefined;
}

/** Balance after the transaction, for the live summary only; the receipt shows the balance the server reports. */
export function balanceAfter(mode: FlowMode, balance: number, digits: string): number {
  const amount = digitsToNumber(digits);
  return mode === "setor" ? balance + amount : balance - amount;
}

export function canReview(mode: FlowMode, digits: string, balance: number, accountId: string | null): boolean {
  return accountId !== null && digits !== "" && digitsToNumber(digits) > 0 && validateAmount(mode, digits, balance) === undefined;
}
