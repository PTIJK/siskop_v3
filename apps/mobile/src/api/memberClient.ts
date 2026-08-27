import type { ApiResponse } from "@siskop/types";
import { getMemberAccessToken, useMemberAuth } from "@/stores/memberAuth";

// Mirrors api/client.ts exactly, but for the member session: separate refresh
// endpoint/cookie, so a member and a staff user can be logged in from the
// same browser without one session's 401 clearing the other's.
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

const NO_REFRESH_PATHS = ["/member-auth/login", "/member-auth/refresh"];

let refreshPromise: Promise<string> | null = null;

export async function refreshMemberAccessToken(): Promise<string> {
  refreshPromise ??= (async () => {
    const res = await fetch("/api/member-auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" }
    });
    const body = (await res.json()) as ApiResponse<{ accessToken: string }>;
    if (!res.ok || !body.success || body.data === undefined) {
      throw new ApiRequestError(body.error?.message ?? "Session expired", body.error?.code ?? "UNAUTHORIZED", res.status);
    }

    useMemberAuth.getState().setAccessToken(body.data.accessToken);
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
  const token = getMemberAccessToken();
  const res = await doRequest(token);

  if (res.status !== 401 || !token || NO_REFRESH_PATHS.includes(path)) {
    return res;
  }

  try {
    const newToken = await refreshMemberAccessToken();
    return await doRequest(newToken);
  } catch {
    useMemberAuth.getState().clear();
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
    if (res.status === 401) useMemberAuth.getState().clear();
    throw new ApiRequestError(
      body.error?.message ?? "Request failed",
      body.error?.code ?? "INTERNAL_ERROR",
      res.status
    );
  }

  return body;
}

export async function memberApiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const body = await envelope<T>(path, init);
  return body.data as T;
}

export async function memberApiFetchPage<T>(
  path: string,
  init: RequestInit = {}
): Promise<{ items: T; meta: ApiResponse<T>["meta"] }> {
  const body = await envelope<T>(path, init);
  return { items: body.data as T, meta: body.meta };
}

export function memberApiPost<T>(path: string, payload: unknown): Promise<T> {
  return memberApiFetch<T>(path, { method: "POST", body: JSON.stringify(payload) });
}

export function memberApiPut<T>(path: string, payload: unknown): Promise<T> {
  return memberApiFetch<T>(path, { method: "PUT", body: JSON.stringify(payload) });
}
