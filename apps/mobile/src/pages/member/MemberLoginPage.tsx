import { PasswordInput } from "@/components/shared/PasswordInput";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { ApiResponse, MemberLoginResponse, WorkspaceContext } from "@siskop/types";
import { memberApiPost, ApiRequestError } from "@/api/memberClient";
import { useMemberAuth } from "@/stores/memberAuth";

export default function MemberLoginPage() {
  const navigate = useNavigate();
  const setSession = useMemberAuth((s) => s.setSession);

  const [nik, setNik] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [workspace, setWorkspace] = useState<WorkspaceContext | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [workspaceError, setWorkspaceError] = useState("");
  const [koperasi, setKoperasi] = useState("");
  useEffect(() => {
    let active = true;
    void fetch("/api/workspace", { cache: "no-store" }).then(async res => {
      const body = await res.json() as ApiResponse<WorkspaceContext | null>;
      if (!res.ok || !body.success) throw new Error(body.error?.message ?? "Koperasi tidak tersedia.");
      if (body.data?.isAlias) {
        const target = new URL(body.data.canonicalLoginUrl);
        const base = import.meta.env.VITE_TENANT_BASE_DOMAIN || "koperasi.inovasijayakarsa.id";
        if (!target.hostname.endsWith(`.${base}`) || !["https:", ...(import.meta.env.DEV ? ["http:"] : [])].includes(target.protocol)) throw new Error("Alamat koperasi tidak valid.");
        target.pathname = "/anggota/login"; target.search = ""; target.hash = "";
        window.location.replace(target.toString()); return;
      }
      if (active) setWorkspace(body.data ?? null);
    }).catch(err => { if (active) setWorkspaceError(err instanceof Error ? err.message : "Koneksi gagal."); })
      .finally(() => { if (active) setLoadingWorkspace(false); });
    return () => { active = false; };
  }, []);

  function openKoperasi(event: FormEvent) {
    event.preventDefault();
    const slug = koperasi.trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) return;
    const base = import.meta.env.VITE_TENANT_BASE_DOMAIN || "koperasi.inovasijayakarsa.id";
    const local = base.endsWith(".localhost");
    window.location.assign(`${local ? "http" : "https"}://${slug}.${base}${local && window.location.port ? `:${window.location.port}` : ""}/anggota/login`);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!workspace || loadingWorkspace) return;
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

        {loadingWorkspace ? <p role="status">Memuat koperasi…</p> : workspaceError ? <div role="alert"><p>{workspaceError}</p><button onClick={() => window.location.reload()}>Coba lagi</button></div> : !workspace ? <form onSubmit={openKoperasi} className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-medium">Pilih alamat koperasi</h2><p className="mt-2 text-sm text-slate-600">Masukkan alamat singkat koperasi Anda, lalu masuk menggunakan NIK dan kata sandi.</p>
          <label htmlFor="koperasi" className="mt-4 block text-sm font-medium">Alamat koperasi</label>
          <input id="koperasi" value={koperasi} onChange={e => setKoperasi(e.target.value)} required pattern="[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*" placeholder="Contoh: ptap" className="mt-1 w-full rounded-md border px-3 py-2" />
          <button type="submit" className="mt-4 w-full rounded-md bg-slate-900 px-4 py-2 text-white">Buka portal anggota</button>
        </form> : <form onSubmit={onSubmit} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-medium text-slate-900">Masuk Anggota</h2>
          <p className="mt-1 text-sm text-slate-500">Koperasi: <span className="font-medium text-slate-700">{workspace.name}</span></p>

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
          <PasswordInput
            id="password"
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
        </form>}

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
