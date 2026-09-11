import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, ArrowUpRight } from "lucide-react";
import type { OnboardingSignInResponse } from "@siskop/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/stores/auth";
import { MarketingShell } from "../components/MarketingShell";
import { AuthMethodSwitch } from "../components/AuthMethodSwitch";
import { identityToken, clearFirebaseIdentity, firebaseError, resetPassword, type AuthMethod } from "../firebase";
import { workspaceSlug } from "../workspace";
import { errorMessage, onboardingApi } from "../api";

export default function AuthPage({ resume = false }: { resume?: boolean }) {
  const [method, setMethod] = useState<AuthMethod>("password");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const busy = useRef(false);
  const navigate = useNavigate();
  const [search] = useSearchParams();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setPending(true); setError(""); setNotice("");
    try {
      const idToken = await identityToken(method, email.trim(), password);
      const result = await onboardingApi<OnboardingSignInResponse>(resume ? "/firebase-resume" : "/login", { idToken });
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
      <main id='main-content' className='resume-main content-width'>
        <section className='checkout-panel'>
          <h1>{resume ? "Lanjutkan pendaftaran." : "Selamat datang kembali."}</h1>
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
            {error ? <p className='form-error' role='alert'>{error}</p> : null}
            {notice ? <p className='auth-notice' role='status'>{notice}</p> : null}
            <Button type='submit' size='lg' disabled={pending}>
              {pending ? <><Loader2 className='animate-spin' /> Memeriksa…</> : <>{method === "google" ? "Lanjutkan dengan Google" : "Masuk"} <ArrowUpRight /></>}
            </Button>
            <p className='form-note'>Belum punya akun? <Link to='/#paket'>Pilih paket & daftar</Link></p>
            {workspaceSlug() !== null || import.meta.env.VITE_ONBOARDING_STAGING !== "true" ? <p className='form-note'><Link to='/login/legacy'>Masuk dengan akun workspace lama</Link></p> : null}
          </form>
        </section>
      </main>
    </MarketingShell>
  );
}
