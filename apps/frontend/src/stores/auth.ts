import { create } from "zustand";
import type { LoginResponse, User } from "@siskop/types";

const ACCESS_KEY = "siskop.accessToken";
const REFRESH_KEY = "siskop.refreshToken";
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
  clear: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  // Seeded from localStorage so a reload does not bounce the user to /login.
  user: readUser(),
  accessToken: localStorage.getItem(ACCESS_KEY),

  setSession: (session) => {
    localStorage.setItem(ACCESS_KEY, session.accessToken);
    localStorage.setItem(REFRESH_KEY, session.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(session.user));
    set({ user: session.user, accessToken: session.accessToken });
  },

  clear: () => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    set({ user: null, accessToken: null });
  }
}));

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}
