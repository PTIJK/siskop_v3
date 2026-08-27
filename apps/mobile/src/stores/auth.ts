import { create } from "zustand";
import type { LoginResponse, User } from "@siskop/types";

const USER_KEY = "siskop.mobile.user";

function readUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  setSession: (session: LoginResponse) => void;
  setAccessToken: (accessToken: string) => void;
  clear: () => void;
}

// Same pattern as apps/frontend/src/stores/auth.ts: the access token lives in
// memory only, never localStorage, so it disappears on reload/tab-close by
// construction. The refresh token never reaches this store — it rides an
// httpOnly cookie set by the backend. A page reload restores the session via
// api/client.ts's silent-refresh bootstrap call, not from anything persisted
// here. Deliberately a separate localStorage key from apps/frontend
// (`siskop.mobile.user` vs `siskop.user`) since the two apps are served from
// different origins/paths and shouldn't assume shared storage.
export const useAuth = create<AuthState>((set) => ({
  user: readUser(),
  accessToken: null,

  setSession: (session) => {
    localStorage.setItem(USER_KEY, JSON.stringify(session.user));
    set({ user: session.user, accessToken: session.accessToken });
  },

  setAccessToken: (accessToken) => set({ accessToken }),

  clear: () => {
    localStorage.removeItem(USER_KEY);
    set({ user: null, accessToken: null });
  }
}));

export function getAccessToken(): string | null {
  return useAuth.getState().accessToken;
}
