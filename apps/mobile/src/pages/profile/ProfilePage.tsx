import { useAuth } from "@/stores/auth";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// FR-MOB-PROFILE-01 (docs/06-PRD-SISKOP-Mobile-Version.md §7): view-only —
// desktop's ProfilePage.tsx has two forms (edit name/email, change password);
// both are write actions and explicitly out of scope (§11). No GET /auth/me
// call needed: the same cached `user` the store already holds since login is
// what desktop's own page reads too (it never re-fetches on mount either).
export function ProfilePage() {
  const user = useAuth((s) => s.user);
  if (!user) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Profil Saya</h1>
        <p className="text-sm text-muted-foreground">Informasi akun Anda</p>
      </div>

      <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted text-base font-medium text-muted-foreground">
          {getInitials(user.name)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.roleName}</p>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Informasi Profil</h2>
        <dl className="space-y-3">
          <div>
            <dt className="text-xs text-muted-foreground">Nama</dt>
            <dd className="mt-0.5 text-sm font-medium">{user.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Email</dt>
            <dd className="mt-0.5 text-sm font-medium">{user.email}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
