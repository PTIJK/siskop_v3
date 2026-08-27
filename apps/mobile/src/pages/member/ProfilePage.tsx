import { useMemberAuth } from "@/stores/memberAuth";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// View-only, same rationale as staff pages/profile/ProfilePage.tsx — a
// password-change form already exists as the forced first-login screen
// (MemberChangePasswordPage), so it isn't duplicated here.
export function MemberProfilePage() {
  const member = useMemberAuth((s) => s.member);
  if (!member) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Profil Saya</h1>
        <p className="text-sm text-muted-foreground">Informasi keanggotaan Anda</p>
      </div>

      <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted text-base font-medium text-muted-foreground">
          {getInitials(member.fullName)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{member.fullName}</p>
          <p className="truncate text-xs text-muted-foreground">{member.memberId}</p>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Informasi Keanggotaan</h2>
        <dl className="space-y-3">
          <div>
            <dt className="text-xs text-muted-foreground">Nama</dt>
            <dd className="mt-0.5 text-sm font-medium">{member.fullName}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">No. Anggota</dt>
            <dd className="mt-0.5 font-mono text-sm font-medium">{member.memberId}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">No. Rekening</dt>
            <dd className="mt-0.5 font-mono text-sm font-medium">{member.accountNumber}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
