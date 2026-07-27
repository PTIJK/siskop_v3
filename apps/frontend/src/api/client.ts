import type { ApiResponse } from "@siskop/types";
import { getAccessToken } from "@/stores/auth";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAccessToken();

  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {})
    }
  });

  const body = (await res.json()) as ApiResponse<T>;

  if (!res.ok || !body.success || body.data === undefined) {
    throw new ApiRequestError(
      body.error?.message ?? "Request failed",
      body.error?.code ?? "INTERNAL_ERROR",
      res.status
    );
  }

  return body.data;
}

export function apiPost<T>(path: string, payload: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: JSON.stringify(payload) });
}
