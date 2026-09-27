import type { CollectionBatch, CollectorTodayItem } from "@siskop/types";
import { apiFetch, apiPost } from "@/api/client";

export function getTodayForCollector() {
  return apiFetch<CollectorTodayItem[]>("/collections/today");
}

/** The collector's own OPEN batch for today, if any — at most one exists (ensureOpenBatchToday, backend). */
export async function getTodayOpenBatch(collectorId: string) {
  const batches = await apiFetch<CollectionBatch[]>(`/collections/batches?status=OPEN&collectorId=${collectorId}`);
  return batches[0] ?? null;
}

export function depositAsCollector(savingId: string, amount: number, idempotencyKey: string) {
  return apiPost<{ id: string }>("/collections/savings-deposit", { savingId, amount }, { "Idempotency-Key": idempotencyKey });
}

export function payLoanAsCollector(loanId: string, amount: number, idempotencyKey: string) {
  return apiPost<{ id: string }>("/collections/loan-payment", { loanId, amount }, { "Idempotency-Key": idempotencyKey });
}

export function payChargeAsCollector(chargeId: string, amount: number, idempotencyKey: string) {
  return apiPost<{ id: string }>("/collections/charge-payment", { chargeId, amount }, { "Idempotency-Key": idempotencyKey });
}

export function submitBatch(batchId: string, idempotencyKey: string) {
  return apiPost<CollectionBatch>(`/collections/batches/${batchId}/submit`, {}, { "Idempotency-Key": idempotencyKey });
}
