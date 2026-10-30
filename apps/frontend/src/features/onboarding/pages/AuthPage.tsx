import { TenantPickerDialog } from "../../tenant-access/TenantPickerDialog";
import { accessApi, useTenantAccessConfig } from "../../tenant-access/api";
import { enterTenant } from "../../tenant-access/enterTenant";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowUpRight, AlertCircle } from "lucide-react";
import type { OnboardingSignInResponse, StaffLoginResult, StaffTenantRedirect, TenantMembershipPage } from "@siskop/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/stores/auth";
import { identityToken, clearFirebaseIdentity, firebaseError, resetPassword, type AuthMethod } from "../firebase";
import { workspaceSlug } from "../workspace";
import { useWorkspace } from "../../workspace-domain/WorkspaceBoundary";
import { errorMessage, onboardingApi } from "../api";
import { useOnboardingMetadata } from "../metadata";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "../styles.css";
import "../login.css";

export default function AuthPage({ resume = false }: { resume?: boolean }) {
  const workspace = useWorkspace();
  const accessConfig = useTenantAccessConfig();
  const [picker, setPicker] = useState(false);
  const [method, setMethod] = useState<AuthMethod>("password");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [noAccess, setNoAccess] = useState(false);
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const busy = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  useOnboardingMetadata(location.pathname);
  const [search] = useSearchParams();
  useEffect(() => {
    if (resume || workspace || search.get("select") !== "1" || !accessConfig.data?.enabled) return;
    void accessApi<TenantMembershipPage>("/memberships").then(async data => {
      if (search.get("tenant") && search.get("membership")) {
        const result = await accessApi<StaffTenantRedirect>("/select", { tenantId: search.get("tenant"), membershipId: search.get("membership") });
        enterTenant(result);
      } else if (data.total === 1 && data.items[0]) {
        const result = await accessApi<StaffTenantRedirect>("/select", { tenantId: data.items[0].tenantId });
        enterTenant(result);
      } else if (data.total > 1) setPicker(true);
      else { setNotice("Anda belum memiliki akses ke koperasi aktif. Hubungi pengelola koperasi."); setNoAccess(true); }
    }).catch(() => { setNotice("Masuk kembali dengan akun yang memiliki akses ke koperasi yang dipilih."); });
  }, [resume, workspace, search, accessConfig.data?.enabled]);
  async function cancelSelection() {
    try { await accessApi("/logout", {}); setPicker(false); setNoAccess(false); setNotice(""); useAuth.getState().clear(); }
    catch (err) { setError(errorMessage(err)); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setPending(true); setError(""); setNotice(""); setNoAccess(false);
    try {
      const idToken = await identityToken(method, email.trim(), password);
      const result: OnboardingSignInResponse | StaffLoginResult = !resume && !workspace && accessConfig.data?.enabled
        ? await accessApi<StaffLoginResult>("/login", { idToken })
        : await onboardingApi<OnboardingSignInResponse>(resume ? "/firebase-resume" : "/login", { idToken });
      if ((result.next === "tenant_redirect" || result.next === "tenant_selection") && search.get("tenant") && search.get("membership")) {
        const selected = await accessApi<StaffTenantRedirect>("/select", { tenantId: search.get("tenant"), membershipId: search.get("membership") });
        useAuth.getState().clear(); enterTenant(selected); return;
      }
      if (result.next === "tenant_redirect") { useAuth.getState().clear(); enterTenant(result); return; }
      if (result.next === "tenant_selection") { useAuth.getState().clear(); setPicker(true); return; }
      if (result.next === "no_access") { setNoAccess(true); useAuth.getState().clear(); setNotice("Anda belum memiliki akses ke koperasi aktif. Hubungi pengelola koperasi."); return; }
      if (result.next === "dashboard") {
        useAuth.getState().setSession(result.session);
        navigate("/dashboard", { replace: true });
      } else {
        useAuth.getState().clear();
        navigate("/checkout", { replace: true });
      }
    } catch (err) {
      setError(firebaseError(err) ?? errorMessage(err));
    } finally {
      await clearFirebaseIdentity();
      busy.current = false; setPending(false);
    }
  }
  async function reset() {
    if (busy.current) return;
    if (!email.trim()) { setError("Isi email Anda terlebih dahulu."); return; }
    busy.current = true; setPending(true); setError(""); setNotice("");
    try {
      await resetPassword(email.trim());
      setNotice("Jika email terdaftar, tautan untuk mengatur ulang kata sandi akan dikirim. Periksa juga folder spam.");
    } catch (err) { setError(firebaseError(err) ?? errorMessage(err)); }
    finally { busy.current = false; setPending(false); }
  }
  const [who, setWho] = useState<"staf" | "anggota">("staf");
  const central = import.meta.env.VITE_PUBLIC_APP_URL ?? "https://siskop-d0f8c.web.app";
  const methods = [["password", "Email dan kata sandi"], ["google", "Google"]] as const;
  return (
    <div className="marketing login-page">
      <main id="konten" className="login-card">
      {picker ? <TenantPickerDialog onCancel={() => void cancelSelection()} /> : null}
      <h1 className="text-[26px] font-extrabold leading-[1.15] tracking-[-0.02em]">{resume ? "Lanjutkan pendaftaran" : "Selamat datang kembali"}</h1>
      {workspace ? <p className="mt-1 text-sm font-semibold">Masuk ke {workspace.name}</p> : null}
      <p className="mt-1 text-sm text-muted-foreground">
        {search.get("registered") === "1" ? "Pembayaran berhasil. Koperasi Anda sudah aktif. Silakan masuk untuk membuka beranda." :
          resume ? "Masuk dengan akun pendaftaran untuk melanjutkan pembayaran." : "Masuk dengan metode yang Anda pilih saat mendaftar."}
      </p>

      {!resume && (
        <div role="tablist" aria-label="Jenis akun" className="mt-6 flex rounded-[11px] bg-muted p-[3px]">
          {([["staf", "Pengurus dan staf"], ["anggota", "Anggota"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`who-${value}`}
              aria-selected={who === value}
              aria-controls="who-panel"
              onClick={() => setWho(value)}
              className="min-h-[38px] flex-1 rounded-[8px] px-4 text-[13.5px] font-bold text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-selected:bg-card aria-selected:text-foreground aria-selected:shadow-sm max-[900px]:min-h-11"
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div id="who-panel" role="tabpanel" aria-labelledby={`who-${who}`} className="mt-5">
        {who === "anggota" && !resume ? (
          <div className="space-y-4 rounded-[14px] border p-4">
            <p className="text-sm font-bold">Masuk sebagai anggota</p>
            <p className="text-sm text-muted-foreground">
              Anggota masuk dengan NIK 16 digit dan kata sandi dari koperasinya. Setelah itu Anda bisa melihat simpanan dan pinjaman sendiri.
            </p>
            <Button asChild size="lg" className="w-full">
              <a href="/anggota/login">
                Lanjut ke masuk anggota <ArrowUpRight aria-hidden="true" />
              </a>
            </Button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={submit} noValidate>
            <fieldset disabled={pending} className="space-y-1.5">
              <legend className="mb-1.5 text-[13px] font-bold">Metode masuk</legend>
              <div role="radiogroup" aria-label="Metode masuk" className="grid grid-cols-2 gap-2">
                {methods.map(([value, label]) => (
                  <label
                    key={value}
                    className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-[10px] border border-input bg-card px-3 text-sm font-semibold transition-colors has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                  >
                    <input
                      type="radio"
                      name="authMethod"
                      value={value}
                      checked={method === value}
                      onChange={() => { setMethod(value); setError(""); }}
                      className="sr-only"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            {method === "password" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="auth-email">Email</Label>
                  <Input id="auth-email" name="email" type="email" required autoComplete="username"
                    value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="auth-password">Kata sandi</Label>
                  <Input id="auth-password" name="password" type="password" required autoComplete="current-password" disabled={pending} />
                </div>
                <button type="button" disabled={pending} onClick={() => void reset()} className="min-h-11 rounded-md text-[13px] font-bold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45">
                  Lupa kata sandi?
                </button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Pilih akun Google yang digunakan saat mendaftar.</p>
            )}

            {accessConfig.isError ? (
              <p role="alert" className="text-sm font-semibold text-destructive">
                Halaman masuk belum siap.{" "}
                <button type="button" className="underline" onClick={() => void accessConfig.refetch()}>Coba lagi</button>
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="flex items-start gap-2 rounded-[10px] bg-destructive/[0.13] p-3 text-sm font-semibold text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {error}
              </p>
            ) : null}
            {noAccess ? <Button type="button" variant="outline" onClick={() => void cancelSelection()}>Keluar</Button> : null}
            {notice ? <p role="status" className="rounded-[10px] bg-accent p-3 text-sm font-semibold text-accent-foreground">{notice}</p> : null}

            <Button type="submit" size="lg" className="w-full" disabled={accessConfig.isPending || accessConfig.isError} loading={pending}>
              {pending ? "Memeriksa…" : <>{method === "google" ? "Lanjutkan dengan Google" : "Masuk"} <ArrowUpRight aria-hidden="true" /></>}
            </Button>
          </form>
        )}
      </div>

      <div className="mt-6 space-y-2 text-[13px] text-muted-foreground">
        {workspace && who === "staf" ? <p><a className="font-bold underline underline-offset-2" href="/anggota/login">Masuk sebagai anggota</a></p> : null}
        <p>
          Belum punya akun?{" "}
          {workspace
            ? <a className="font-bold underline underline-offset-2" href={`${central}/#paket`}>Pilih paket dan daftar</a>
            : <Link className="font-bold underline underline-offset-2" to="/#paket">Pilih paket dan daftar</Link>}
        </p>
        {workspaceSlug() !== null || import.meta.env.VITE_ONBOARDING_STAGING !== "true" ? <p><Link className="font-bold underline underline-offset-2" to="/login/legacy">Masuk dengan akun workspace lama</Link></p> : null}
      </div>
      </main>
    </div>
  );
}
