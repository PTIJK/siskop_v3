import { create } from "zustand";
import type { LoginResponse, User } from "@siskop/types";

const USER_KEY = "siskop.user";

function readUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    // A corrupt entry should log the user out, not crash the app shell.
    return null;
  }
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  setSession: (session: LoginResponse) => void;
  setAccessToken: (accessToken: string) => void;
  updateUser: (user: User) => void;
  clear: () => void;
}

// The access token lives in memory only — not localStorage — so an XSS
// payload reading storage at rest finds nothing, and it disappears on
// reload/tab-close by construction. The refresh token never reaches this
// store at all: it rides an httpOnly cookie set by the backend (see
// modules/auth/refresh-cookie.ts), invisible to any JS on this page. A page
// reload restores the session via api/client.ts's bootstrap silent-refresh
// call, not from anything persisted here.
export const useAuth = create<AuthState>((set) => ({
  user: readUser(),
  accessToken: null,

  setSession: (session) => {
    localStorage.setItem(USER_KEY, JSON.stringify(session.user));
    set({ user: session.user, accessToken: session.accessToken });
  },

  setAccessToken: (accessToken) => set({ accessToken }),

  // Profile self-edit (name/email) doesn't mint new tokens, so only the
  // cached user record needs updating — see pages/profile/ProfilePage.
  updateUser: (user) => {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ user });
  },

  clear: () => {
    localStorage.removeItem(USER_KEY);
    set({ user: null, accessToken: null });
  }
}));

export function getAccessToken(): string | null {
  return useAuth.getState().accessToken;
}
