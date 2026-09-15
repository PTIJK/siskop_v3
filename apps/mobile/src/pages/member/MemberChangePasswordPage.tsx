import { PasswordInput } from "@/components/shared/PasswordInput";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { memberApiPut, ApiRequestError } from "@/api/memberClient";
import { useMemberAuth } from "@/stores/memberAuth";

// Forced first-login screen: MemberAppLayout redirects here whenever
// member.mustChangePassword is true, blocking every other /anggota/* route
// until the birthdate default is replaced with a password only the member knows.
export function MemberChangePasswordPage() {
  const navigate = useNavigate();
  const member = useMemberAuth((s) => s.member);
  const setMember = useMemberAuth((s) => s.setMember);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Konfirmasi kata sandi belum cocok.");
      return;
    }
    setPending(true);

    try {
      await memberApiPut("/member-auth/me/password", { currentPassword, newPassword });
      if (member) setMember({ ...member, mustChangePassword: false });
      navigate("/anggota/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Tidak dapat terhubung ke server");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-slate-900">Ganti Kata Sandi</h1>
          <p className="mt-1 text-sm text-slate-600">
            Anda masih menggunakan kata sandi awal. Buat kata sandi baru sebelum melanjutkan.
          </p>
        </div>

        <form onSubmit={onSubmit} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <p className="mb-4 text-sm text-slate-600">Kata sandi saat ini adalah kata sandi yang baru Anda gunakan untuk masuk. Jika ini login pertama, gunakan kata sandi awal dari petugas.</p>
          <label className="block text-sm font-medium text-slate-700" htmlFor="currentPassword">
            Kata sandi saat ini
          </label>
          <PasswordInput
            id="currentPassword"
            disabled={pending}
            required
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-500"
          />

          <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="newPassword">
            Kata sandi baru
          </label>
          <PasswordInput
            id="newPassword"
            disabled={pending}
            required
            minLength={8}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-500"
          />
          <p className="mt-1 text-xs text-slate-500">Minimal 8 karakter.</p>

          <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="confirmPassword">Konfirmasi kata sandi baru</label>
          <PasswordInput
            id="confirmPassword"
            disabled={pending}
            required
            autoComplete="new-password"
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-500"
          />

          {error && (
            <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-6 w-full rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {pending ? "Menyimpan…" : "Simpan Kata Sandi"}
          </button>
        </form>
      </div>
    </main>
  );
}
