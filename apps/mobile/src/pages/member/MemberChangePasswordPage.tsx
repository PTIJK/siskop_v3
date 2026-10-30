import { PasswordInput } from "@/components/shared/PasswordInput";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { memberApiPut, ApiRequestError } from "@/api/memberClient";
import { useMemberAuth } from "@/stores/memberAuth";
import { MemberAuthLayout } from "@/components/layout/MemberAuthLayout";
import { alertClass, inputClass, labelClass, primaryButtonClass } from "@/lib/ui";

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
    <MemberAuthLayout
      title="Ganti Kata Sandi"
      description="Anda masih menggunakan kata sandi awal. Buat kata sandi baru sebelum melanjutkan."
    >
      <form onSubmit={onSubmit}>
        <p className="mb-4 text-[13px] text-muted-foreground">
          Kata sandi saat ini adalah kata sandi yang baru Anda gunakan untuk masuk. Jika ini login pertama, gunakan kata sandi awal dari petugas.
        </p>
        <label className={labelClass} htmlFor="currentPassword">
          Kata sandi saat ini
        </label>
        <PasswordInput
          id="currentPassword"
          disabled={pending}
          required
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={inputClass}
        />

        <label className={`${labelClass} mt-4`} htmlFor="newPassword">
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
          className={inputClass}
        />
        <p className="mt-1.5 text-xs text-muted-foreground">Minimal 8 karakter.</p>

        <label className={`${labelClass} mt-4`} htmlFor="confirmPassword">
          Konfirmasi kata sandi baru
        </label>
        <PasswordInput
          id="confirmPassword"
          disabled={pending}
          required
          autoComplete="new-password"
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className={inputClass}
        />

        {error && (
          <p role="alert" className={`${alertClass} mt-4`}>
            {error}
          </p>
        )}

        <button type="submit" disabled={pending} className={`${primaryButtonClass} mt-6`}>
          {pending ? "Menyimpan…" : "Simpan Kata Sandi"}
        </button>
      </form>
    </MemberAuthLayout>
  );
}
