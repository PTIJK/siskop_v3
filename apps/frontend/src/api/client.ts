import type { ApiResponse } from "@siskop/types";
import { getAccessToken, useAuth } from "@/stores/auth";

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

// These don't carry (or aren't protecting with) an access token, so a 401 from
// them is a real auth failure, not an expired-access-token situation — chasing
// them through the refresh-and-retry path below would just loop.
const NO_REFRESH_PATHS = ["/auth/login", "/auth/refresh", "/auth/register"];

// Concurrent 401s (several queries expiring at once) must share one refresh
// call rather than each minting its own new access token.
let refreshPromise: Promise<string> | null = null;

/**
 * Exchanges the httpOnly refresh cookie (invisible to this JS — the browser
 * attaches it automatically via `credentials: "include"`) for a new access
 * token. Also the app's bootstrap call: since the access token lives only in
 * memory (see stores/auth.ts), a page reload has none, and this is what
 * restores the session from the cookie without redirecting to /login first.
 */
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

/**
 * Retries once with a refreshed token on a 401; falls through to the original
 * response on any other failure. Also covers a *missing* token (not just a
 * rejected one) — the access token lives only in memory (stores/auth.ts), so
 * it's always null right after a page reload, and the app deliberately
 * doesn't block rendering on a separate bootstrap step waiting for one (see
 * AppLayout.tsx): the first query fired with no token yet just 401s here and
 * transparently refreshes-and-retries, same as a token that expired mid-session.
 */
async function withAuthRetry(
  path: string,
  doRequest: (token: string | null) => Promise<Response>
): Promise<Response> {
  const token = getAccessToken();
  const res = await doRequest(token);

  if (res.status !== 401 || NO_REFRESH_PATHS.includes(path)) {
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
    // A 401 that survived a refresh attempt (or had no token to refresh) means
    // the session is truly gone — clear it so AppLayout's guard redirects to /login.
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
  const res = await withAuthRetry(path, (token) =>
    fetch(`/api${path}`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData
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

  return body.data;
}
