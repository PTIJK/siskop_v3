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

async function envelope<T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> {
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

  return body;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const body = await envelope<T>(path, init);
  return body.data as T;
}

/** For paginated list endpoints — returns `meta.page/limit/total` alongside the items. */
export async function apiFetchPage<T>(
  path: string,
  init: RequestInit = {}
): Promise<{ items: T; meta: ApiResponse<T>["meta"] }> {
  const body = await envelope<T>(path, init);
  return { items: body.data as T, meta: body.meta };
}

export function apiPost<T>(path: string, payload: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: JSON.stringify(payload) });
}

export function apiPut<T>(path: string, payload: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "PUT", body: JSON.stringify(payload) });
}

export function apiPatch<T>(path: string, payload: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(payload) });
}

export function apiDelete<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: "DELETE" });
}

/** Multipart upload (e.g. KTP photo) — omits the JSON Content-Type header so the browser sets the boundary. */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const token = getAccessToken();

  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData
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
