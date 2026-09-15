import type { ApiResponse } from "@siskop/types";
import { ApiRequestError } from "@/api/client";

// A standalone client, deliberately not apiFetch/apiPost from @/api/client:
// this endpoint carries no session (no bearer token, no refresh-on-401), the
// same reasoning features/onboarding/api.ts documents for its own public
// client. Requests are addressed by :tenantSlug in the path, matching the
// backend's public-registration.routes.ts.
async function envelope<T>(tenantSlug: string, init: RequestInit): Promise<T> {
  const response = await fetch(`/api/public/register/${encodeURIComponent(tenantSlug)}`, init);
  let result: ApiResponse<T>;
  try {
    result = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new Error("Server belum dapat dihubungi. Silakan coba lagi.");
  }
  if (!response.ok || !result.success || result.data === undefined) {
    throw new ApiRequestError(
      result.error?.message ?? "Permintaan belum berhasil",
      result.error?.code ?? "INTERNAL_ERROR",
      response.status
    );
  }
  return result.data;
}

export function fetchPublicTenantBranding<T>(tenantSlug: string): Promise<T> {
  return envelope<T>(tenantSlug, { method: "GET" });
}

/** `formData` carries every field plus captchaToken, and optionally a "ktp" file. */
export function submitPublicRegistration<T>(tenantSlug: string, formData: FormData): Promise<T> {
  return envelope<T>(tenantSlug, { method: "POST", body: formData });
}
