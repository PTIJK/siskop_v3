import { create } from "zustand";
import type { MemberLoginResponse, MemberProfile } from "@siskop/types";

const MEMBER_KEY = "siskop.mobile.member";

function readMember(): MemberProfile | null {
  const raw = localStorage.getItem(MEMBER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MemberProfile;
  } catch {
    return null;
  }
}

interface MemberAuthState {
  member: MemberProfile | null;
  accessToken: string | null;
  setSession: (session: MemberLoginResponse) => void;
  setAccessToken: (accessToken: string) => void;
  setMember: (member: MemberProfile) => void;
  clear: () => void;
}

// Same shape/rationale as stores/auth.ts, but for a member's own session —
// deliberately a separate store/localStorage key so a staff session and a
// member session can never bleed into each other on the same device.
export const useMemberAuth = create<MemberAuthState>((set) => ({
  member: readMember(),
  accessToken: null,

  setSession: (session) => {
    localStorage.setItem(MEMBER_KEY, JSON.stringify(session.member));
    set({ member: session.member, accessToken: session.accessToken });
  },

  setAccessToken: (accessToken) => set({ accessToken }),

  setMember: (member) => {
    localStorage.setItem(MEMBER_KEY, JSON.stringify(member));
    set({ member });
  },

  clear: () => {
    localStorage.removeItem(MEMBER_KEY);
    set({ member: null, accessToken: null });
  }
}));

export function getMemberAccessToken(): string | null {
  return useMemberAuth.getState().accessToken;
}
