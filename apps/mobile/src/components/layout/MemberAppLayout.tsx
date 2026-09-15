import type { MemberProfile } from "@siskop/types";
import { useEffect, useState } from "react";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import { useMemberAuth } from "@/stores/memberAuth";
import { refreshMemberAccessToken, memberApiFetch } from "@/api/memberClient";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { MemberTopbar } from "./MemberTopbar";
import { MemberBottomNav } from "./MemberBottomNav";

// Mirrors AppLayout.tsx's silent-refresh-then-redirect bootstrap, but for the
// member session, and additionally forces the password-change screen for any
// member still on the birthdate-derived default password.
export function MemberAppLayout() {
  const accessToken = useMemberAuth((s) => s.accessToken);
  const member = useMemberAuth((s) => s.member);
  const location = useLocation();
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!useMemberAuth.getState().accessToken) await refreshMemberAccessToken();
      const profile = await memberApiFetch<MemberProfile>("/member-auth/me");
      if (active) useMemberAuth.getState().setMember(profile);
    })().catch(() => { if (active) useMemberAuth.getState().clear(); })
      .finally(() => { if (active) setBootstrapping(false); });
    return () => { active = false; };
  }, []);

  if (bootstrapping) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <PageLoading />
      </div>
    );
  }

  if (!accessToken) return <Navigate to="/anggota/login" replace />;
  if (location.pathname === "/anggota/ganti-password") return <Outlet />;
  if (member?.mustChangePassword) return <Navigate to="/anggota/ganti-password" replace />;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <MemberTopbar />
      <main className="flex-1 overflow-y-auto p-4 pb-20">
        <Outlet />
      </main>
      <MemberBottomNav />
    </div>
  );
}
