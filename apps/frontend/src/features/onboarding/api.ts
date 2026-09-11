import type { ApiResponse } from "@siskop/types";
import { ApiRequestError } from "@/api/client";

// Public onboarding has its own cookie and must never refresh or clear a
// signed-in dashboard session when an onboarding cookie expires.
export async function onboardingApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/onboarding${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  let result: ApiResponse<T>;
  try {
    result = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new Error("Server belum dapat dihubungi. Silakan coba lagi.");
  }
  if (!response.ok || !result.success || result.data === undefined)
    throw new ApiRequestError(
      result.error?.message ?? "Permintaan belum berhasil",
      result.error?.code ?? "INTERNAL_ERROR",
      response.status
    );
  return result.data;
}
export const rupiah = (amount: string) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(
    Number(amount)
  );
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Terjadi kesalahan. Silakan coba lagi.";
export const unitNames = {
  KSP: "Simpan pinjam",
  KONSUMEN: "Konsumen",
  PRODUSEN: "Produsen",
  JASA: "Jasa",
  PEMASARAN: "Pemasaran"
};
