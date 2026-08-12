import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { LoginResponse } from "@siskop/types";
import { apiPost, ApiRequestError } from "@/api/client";
import { useAuth } from "@/stores/auth";

// Ported verbatim (markup + colors) from apps/frontend/src/pages/LoginPage.tsx —
// docs/06-PRD-SISKOP-Mobile-Version.md §12 item 5: the login screen especially
// should look identical to desktop, since it's already a single-column,
// already-mobile-ready layout (confirmed in the UI audit) with nothing to fix.
function currentSlug(): string | null {
  const [first, ...rest] = window.location.hostname.split(".");
  return rest.length > 0 && first ? first : null;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuth((s) => s.setSession);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const slug = currentSlug();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const session = await apiPost<LoginResponse>("/auth/login", { email, password });
      setSession(session);
      navigate("/", { replace: true });
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
          <p className="mt-1 text-sm text-slate-600">Sistem Informasi Koperasi — Mobile</p>
        </div>

        <form onSubmit={onSubmit} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-medium text-slate-900">Masuk</h2>
          {slug ? (
            <p className="mt-1 text-sm text-slate-500">
              Koperasi: <span className="font-medium text-slate-700">{slug}</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-amber-700">
              Gunakan alamat koperasi Anda, misalnya <span className="font-mono">demo.localhost:3002</span>
            </p>
          )}

          <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
      </div>
    </main>
  );
}
