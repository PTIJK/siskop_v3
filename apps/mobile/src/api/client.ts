import type { ApiResponse } from "@siskop/types";
import { getAccessToken, useAuth } from "@/stores/auth";

// Ported behavior (not code) from apps/frontend/src/api/client.ts — see
// docs/07-System-Architecture-SISKOP-Mobile-Version.md §4: same shape,
// separate small file, since the backend contract is identical.
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

const NO_REFRESH_PATHS = ["/auth/login", "/auth/refresh", "/auth/register"];

let refreshPromise: Promise<string> | null = null;

export async function refreshAccessToken(): Promise<string> {
  refreshPromise ??= (async () => {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" }
    });
    const body = (await res.json()) as ApiResponse<{ accessToken: string }>;
    if (!res.ok || !body.success || body.data === undefined) {
      throw new ApiRequestError(body.error?.message ?? "Session expired", body.error?.code ?? "UNAUTHORIZED", res.status);
    }

    useAuth.getState().setAccessToken(body.data.accessToken);
    return body.data.accessToken;
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

async function withAuthRetry(
  path: string,
  doRequest: (token: string | null) => Promise<Response>
): Promise<Response> {
  const token = getAccessToken();
  const res = await doRequest(token);

  if (res.status !== 401 || !token || NO_REFRESH_PATHS.includes(path)) {
    return res;
  }

  try {
    const newToken = await refreshAccessToken();
    return await doRequest(newToken);
  } catch {
    useAuth.getState().clear();
    return res;
  }
}

async function envelope<T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> {
  const res = await withAuthRetry(path, (token) =>
    fetch(`/api${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {})
      }
    })
  );

  const body = (await res.json()) as ApiResponse<T>;

  if (!res.ok || !body.success || body.data === undefined) {
    if (res.status === 401) useAuth.getState().clear();
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
