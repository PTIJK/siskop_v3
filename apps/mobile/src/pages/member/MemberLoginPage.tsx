import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { MemberLoginResponse } from "@siskop/types";
import { memberApiPost, ApiRequestError } from "@/api/memberClient";
import { useMemberAuth } from "@/stores/memberAuth";

// Mirrors pages/LoginPage.tsx, but the member types their NIK — Member has
// no email field (see packages/types/src/user.ts#MemberLoginRequest).
function currentSlug(): string | null {
  const [first, ...rest] = window.location.hostname.split(".");
  return rest.length > 0 && first ? first : null;
}

export default function MemberLoginPage() {
  const navigate = useNavigate();
  const setSession = useMemberAuth((s) => s.setSession);

  const [nik, setNik] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const slug = currentSlug();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const session = await memberApiPost<MemberLoginResponse>("/member-auth/login", { nik, password });
      setSession(session);
      navigate(session.member.mustChangePassword ? "/anggota/ganti-password" : "/anggota/dashboard", {
        replace: true
      });
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
          <h1 className="text-2xl font-semibold text-slate-900">SISKOP</h1>
          <p className="mt-1 text-sm text-slate-600">Portal Anggota</p>
        </div>

        <form onSubmit={onSubmit} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-medium text-slate-900">Masuk Anggota</h2>
          {slug ? (
            <p className="mt-1 text-sm text-slate-500">
              Koperasi: <span className="font-medium text-slate-700">{slug}</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-amber-700">
              Gunakan alamat koperasi Anda, misalnya <span className="font-mono">demo.localhost:3002</span>
            </p>
          )}

          <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="nik">
            NIK
          </label>
          <input
            id="nik"
            type="text"
            inputMode="numeric"
            required
            autoComplete="username"
            value={nik}
            onChange={(e) => setNik(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-500"
          />

          <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="password">
            Kata sandi
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-slate-500"
          />
          <p className="mt-1 text-xs text-slate-500">
            Kata sandi awal adalah tanggal lahir Anda (format DDMMYYYY), diaktifkan oleh petugas koperasi.
          </p>

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
            {pending ? "Memproses…" : "Masuk"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-600">
          Petugas koperasi?{" "}
          <a href="/login" className="font-medium text-slate-900 underline">
            Masuk di sini
          </a>
        </p>
      </div>
    </main>
  );
}
