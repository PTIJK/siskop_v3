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
        <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.02em]">Profil Saya</h1>
        <p className="text-sm text-muted-foreground">Informasi keanggotaan Anda</p>
      </div>

      <div className="flex items-center gap-3.5 rounded-[16px] border bg-card p-[18px]">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-extrabold text-accent-foreground">
          {getInitials(member.fullName)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-base font-extrabold">{member.fullName}</p>
          <p className="money truncate text-xs text-muted-foreground">{member.memberId}</p>
        </div>
      </div>

      <div className="rounded-[16px] border bg-card p-[18px]">
        <h2 className="mb-3 text-[15px] font-extrabold tracking-tight">Informasi Keanggotaan</h2>
        <dl className="space-y-3">
          <div>
            <dt className="text-xs text-muted-foreground">Nama</dt>
            <dd className="mt-0.5 text-sm font-bold">{member.fullName}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">No. Anggota</dt>
            <dd className="money mt-0.5 text-sm font-bold">{member.memberId}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">No. Rekening</dt>
            <dd className="money mt-0.5 text-sm font-bold">{member.accountNumber}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
