import { TenantPickerDialog } from "../../tenant-access/TenantPickerDialog";
import { accessApi, useTenantAccessConfig } from "../../tenant-access/api";
import { canonicalWorkspaceUrl } from "../../workspace-domain/host";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, ArrowUpRight } from "lucide-react";
import type { OnboardingSignInResponse, StaffLoginResult, TenantMembershipPage } from "@siskop/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/stores/auth";
import { MarketingShell } from "../components/MarketingShell";
import { AuthMethodSwitch } from "../components/AuthMethodSwitch";
import { identityToken, clearFirebaseIdentity, firebaseError, resetPassword, type AuthMethod } from "../firebase";
import { workspaceSlug } from "../workspace";
import { useWorkspace } from "../../workspace-domain/WorkspaceBoundary";
import { errorMessage, onboardingApi } from "../api";

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
  const [search] = useSearchParams();
  useEffect(() => {
    if (resume || workspace || search.get("select") !== "1" || !accessConfig.data?.enabled) return;
    void accessApi<TenantMembershipPage>("/memberships").then(async data => {
      if (search.get("tenant") && search.get("membership")) {
        const result = await accessApi<{ startUrl: string }>("/select", { tenantId: search.get("tenant"), membershipId: search.get("membership") });
        window.location.replace(canonicalWorkspaceUrl(result.startUrl));
      } else if (data.total === 1 && data.items[0]) {
        const result = await accessApi<{ startUrl: string }>("/select", { tenantId: data.items[0].tenantId });
        window.location.replace(canonicalWorkspaceUrl(result.startUrl));
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
        const selected = await accessApi<{ startUrl: string }>("/select", { tenantId: search.get("tenant"), membershipId: search.get("membership") });
        useAuth.getState().clear(); window.location.assign(canonicalWorkspaceUrl(selected.startUrl)); return;
      }
      if (result.next === "tenant_redirect") { useAuth.getState().clear(); window.location.assign(canonicalWorkspaceUrl(result.startUrl)); return; }
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
  return (
    <MarketingShell>
      {picker ? <TenantPickerDialog onCancel={() => void cancelSelection()} /> : null}
      <main id='main-content' className='resume-main content-width'>
        <section className='checkout-panel'>
          <h1>{resume ? "Lanjutkan pendaftaran." : "Selamat datang kembali."}</h1>
          {workspace ? <p className="checkout-description">Masuk ke {workspace.name}</p> : null}
          <p className='checkout-description'>
            {search.get("registered") === "1" ? "Pembayaran berhasil. Koperasi Anda sudah aktif. Silakan masuk untuk membuka dashboard." :
              resume ? "Masuk dengan akun pendaftaran untuk melanjutkan pembayaran." : "Masuk dengan metode yang Anda pilih saat mendaftar."}
          </p>
          <form className='resume-form' onSubmit={submit}>
            <AuthMethodSwitch value={method} onChange={(value) => { setMethod(value); setError(""); }} disabled={pending} />
            {method === "password" ? <>
              <div className='field'>
                <Label htmlFor='auth-email'>Email</Label>
                <Input id='auth-email' name='email' type='email' required autoComplete='username'
                  value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending} />
              </div>
              <div className='field'>
                <Label htmlFor='auth-password'>Kata sandi</Label>
                <Input id='auth-password' name='password' type='password' required autoComplete='current-password' disabled={pending} />
              </div>
              <button className='auth-reset' type='button' disabled={pending} onClick={() => void reset()}>Lupa kata sandi?</button>
            </> : <p className='form-note'>Pilih akun Google yang digunakan saat mendaftar.</p>}
            {accessConfig.isError ? <p role="alert">Halaman masuk belum siap. <button type="button" onClick={() => void accessConfig.refetch()}>Coba lagi</button></p> : null}
            {error ? <p className='form-error' role='alert'>{error}</p> : null}
            {noAccess ? <Button type="button" variant="outline" onClick={() => void cancelSelection()}>Keluar</Button> : null}
            {notice ? <p className='auth-notice' role='status'>{notice}</p> : null}
            <Button type='submit' size='lg' disabled={pending || accessConfig.isPending || accessConfig.isError}>
              {pending ? <><Loader2 className='animate-spin' /> Memeriksa…</> : <>{method === "google" ? "Lanjutkan dengan Google" : "Masuk"} <ArrowUpRight /></>}
            </Button>
            {workspace ? <p className='form-note'><a href="/anggota/login">Masuk sebagai anggota</a></p> : null}
            <p className='form-note'>Belum punya akun? {workspace
              ? <a href={`${import.meta.env.VITE_PUBLIC_APP_URL ?? "https://siskop-d0f8c.web.app"}/#paket`}>Pilih paket & daftar</a>
              : <Link to='/#paket'>Pilih paket & daftar</Link>}</p>
            {workspaceSlug() !== null || import.meta.env.VITE_ONBOARDING_STAGING !== "true" ? <p className='form-note'><Link to='/login/legacy'>Masuk dengan akun workspace lama</Link></p> : null}
          </form>
        </section>
      </main>
    </MarketingShell>
  );
}
