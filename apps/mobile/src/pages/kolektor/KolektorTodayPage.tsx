import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { WifiOff, Check, PiggyBank, Store, Receipt } from "lucide-react";
import { ApiRequestError } from "@/api/client";
import { useAuth } from "@/stores/auth";
import { formatRupiah, formatRupiahSingkat } from "@/lib/format";
import { EntitlementNotice } from "@/components/shared/EntitlementNotice";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { cn } from "@/lib/utils";
import {
  depositAsCollector,
  getTodayForCollector,
  getTodayOpenBatch,
  payChargeAsCollector,
  payLoanAsCollector,
  submitBatch
} from "./api";

/** Online-only per F6 plan — no offline queue/sync in scope, so writes are simply disabled while offline. */
function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return isOnline;
}

interface QuickPayRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  defaultAmount: number;
  actionLabel?: string;
  disabled?: boolean;
  onSubmit: (amount: number, idempotencyKey: string) => Promise<unknown>;
}

/**
 * One quick-input line item (cicilan/retribusi/sewa/tabungan) — "input cepat
 * per pedagang... konfirmasi, bukti transaksi di layar" (F6 plan). Each row
 * owns its own submit state and Idempotency-Key: the key is minted once per
 * attempt and reused on a retry (same key = same logical attempt) until it
 * succeeds, so a dropped connection never double-books this line.
 */
function QuickPayRow({ icon: Icon, label, hint, defaultAmount, actionLabel = "Setor", disabled, onSubmit }: QuickPayRowProps) {
  const [amount, setAmount] = useState(defaultAmount > 0 ? String(defaultAmount) : "");
  const [status, setStatus] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const idempotencyKeyRef = useRef<string | null>(null);

  async function handleSubmit() {
    idempotencyKeyRef.current ??= crypto.randomUUID();
    setStatus("pending");
    setErrorMessage("");
    try {
      await onSubmit(Number(amount), idempotencyKeyRef.current);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof ApiRequestError ? err.message : "Gagal menyimpan, coba lagi");
    }
  }

  if (status === "done") {
    return (
      <div className="flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
        <Check className="h-4 w-4 shrink-0" />
        <span className="truncate">
          {label} — {formatRupiah(amount)} tercatat
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-md border p-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <p className="truncate text-sm font-medium text-foreground">{label}</p>
      </div>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-2 flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          placeholder="Nominal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={disabled || status === "pending"}
          className="w-full min-w-0 rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || status === "pending" || !amount || Number(amount) <= 0}
          className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          {status === "pending" ? "Memproses…" : actionLabel}
        </button>
      </div>
      {status === "error" && <p className="mt-1 text-xs text-destructive">{errorMessage}</p>}
    </div>
  );
}

export function KolektorTodayPage() {
  const user = useAuth((s) => s.user);
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const submitKeyRef = useRef<string | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const todayQuery = useQuery({ queryKey: ["kolektor", "today"], queryFn: getTodayForCollector });
  const batchQuery = useQuery({
    queryKey: ["kolektor", "batch", user?.id],
    queryFn: () => getTodayOpenBatch(user!.id),
    enabled: !!user
  });

  const notEntitled =
    (todayQuery.error instanceof ApiRequestError && todayQuery.error.code === "FEATURE_NOT_ENTITLED") ||
    (batchQuery.error instanceof ApiRequestError && batchQuery.error.code === "FEATURE_NOT_ENTITLED");

  function refetchBatch() {
    void queryClient.invalidateQueries({ queryKey: ["kolektor", "batch"] });
  }

  async function handleSubmitBatch() {
    if (!batchQuery.data) return;
    if (!confirmingSubmit) {
      setConfirmingSubmit(true);
      return;
    }
    submitKeyRef.current ??= crypto.randomUUID();
    setSubmitting(true);
    setSubmitError("");
    try {
      await submitBatch(batchQuery.data.id, submitKeyRef.current);
      refetchBatch();
      setConfirmingSubmit(false);
    } catch (err) {
      setSubmitError(err instanceof ApiRequestError ? err.message : "Gagal menyerahkan setoran, coba lagi");
    } finally {
      setSubmitting(false);
    }
  }

  if (todayQuery.isPending || batchQuery.isPending) return <PageLoading />;

  if (notEntitled) {
    const message =
      (todayQuery.error instanceof ApiRequestError && todayQuery.error.message) ||
      (batchQuery.error instanceof ApiRequestError && batchQuery.error.message) ||
      "Fitur ini tidak termasuk dalam paket koperasi Anda";
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold">Setoran Hari Ini</h1>
        <EntitlementNotice message={message} />
      </div>
    );
  }

  const items = todayQuery.data ?? [];
  const batch = batchQuery.data;

  let previousGroupKey: string | null = null;

  return (
    <div className="space-y-4 pb-24">
      <div>
        <h1 className="text-lg font-semibold">Setoran Hari Ini</h1>
        <p className="text-sm text-muted-foreground">{items.length} anggota binaan</p>
      </div>

      {!isOnline && (
        <div className="flex items-center gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
          <WifiOff className="h-4 w-4 shrink-0 text-amber-700" />
          <p className="text-xs font-medium text-amber-800">
            Tidak ada koneksi internet. Setoran tidak dapat disimpan saat offline.
          </p>
        </div>
      )}

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border py-10 text-center text-muted-foreground">
          <p className="text-sm">Belum ada anggota binaan</p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const groupKey = item.location
              ? `${item.location.marketName} — Blok ${item.location.block ?? "-"}`
              : "Tanpa Lokasi Kios";
            const showGroupHeading = groupKey !== previousGroupKey;
            previousGroupKey = groupKey;

            const hasNothingDue = !item.amountDue && item.charges.length === 0 && !item.dailySavingId;

            return (
              <div key={item.memberId}>
                {showGroupHeading && (
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{groupKey}</p>
                )}
                <div className="rounded-lg border bg-card p-3">
                  <div className="mb-2">
                    <p className="truncate text-sm font-medium">{item.memberName}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{item.memberCode}</p>
                  </div>

                  {hasNothingDue && <p className="text-xs text-muted-foreground">Tidak ada tagihan hari ini</p>}

                  <div className="space-y-2">
                    {item.amountDue && (
                      <QuickPayRow
                        icon={Receipt}
                        label="Cicilan Pinjaman"
                        hint={item.daysOverdue > 0 ? `Jatuh tempo ${item.dueDate}, ${item.daysOverdue} hari terlambat` : `Jatuh tempo ${item.dueDate}`}
                        defaultAmount={Number(item.amountDue)}
                        disabled={!isOnline}
                        onSubmit={(amount, key) => payLoanAsCollector(item.loanId!, amount, key).then(refetchBatch)}
                      />
                    )}

                    {item.charges.map((charge) => (
                      <QuickPayRow
                        key={charge.chargeId}
                        icon={Store}
                        label={charge.kind === "SEWA" ? "Sewa Kios" : "Retribusi"}
                        hint={charge.daysOverdue > 0 ? `Jatuh tempo ${charge.dueDate}, ${charge.daysOverdue} hari terlambat` : `Jatuh tempo ${charge.dueDate}`}
                        defaultAmount={Number(charge.amountDue)}
                        disabled={!isOnline}
                        onSubmit={(amount, key) => payChargeAsCollector(charge.chargeId, amount, key).then(refetchBatch)}
                      />
                    ))}

                    {item.dailySavingId && (
                      <QuickPayRow
                        icon={PiggyBank}
                        label="Tabungan Harian"
                        defaultAmount={0}
                        disabled={!isOnline}
                        onSubmit={(amount, key) => depositAsCollector(item.dailySavingId!, amount, key).then(refetchBatch)}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-14 z-30 border-t bg-background px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Total Setoran Hari Ini</p>
            <p className="text-lg font-bold">{formatRupiahSingkat(batch?.expectedTotal ?? "0")}</p>
          </div>
          <button
            type="button"
            onClick={handleSubmitBatch}
            disabled={!batch || !isOnline || submitting}
            className={cn(
              "shrink-0 rounded-md px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50",
              confirmingSubmit ? "bg-destructive" : "bg-primary"
            )}
          >
            {submitting ? "Memproses…" : confirmingSubmit ? "Yakin? Ketuk lagi" : "Serahkan Setoran"}
          </button>
        </div>
        {submitError && <p className="mt-1.5 text-xs text-destructive">{submitError}</p>}
      </div>
    </div>
  );
}
