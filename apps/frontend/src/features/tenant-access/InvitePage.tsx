import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { identityToken, verifyInvitationEmail, clearFirebaseIdentity, firebaseError, type AuthMethod } from "@/features/onboarding/firebase";
import { AuthMethodSwitch } from "@/features/onboarding/components/AuthMethodSwitch";
import { accessApi, centralLocation } from "./api";
export default function InvitePage() {
  const token = useRef(new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
  const [method, setMethod] = useState<AuthMethod>("google");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  async function accept(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (pending) return;
    setPending(true); setMessage("");
    try {
      const password = String(new FormData(e.currentTarget).get("password") ?? "");
      const idToken = await identityToken(method, email.trim(), password);
      const result = await accessApi<{ tenantName: string }>("/accept-invitation", { token: token.current, idToken });
      window.history.replaceState(null, "", "/invite"); setDone(true); setMessage(`Akses ke ${result.tenantName} berhasil ditambahkan.`);
    } catch (err) { setMessage(firebaseError(err) ?? (err instanceof Error ? err.message : "Undangan belum dapat diterima.")); }
    finally { await clearFirebaseIdentity(); setPending(false); }
  }
  async function verify(form: HTMLFormElement | null, register: boolean) {
    if (!form || pending || !form.reportValidity()) return;
    setPending(true); setMessage("");
    try {
      await verifyInvitationEmail(email.trim(), String(new FormData(form).get("password") ?? ""), register);
      setMessage("Periksa email verifikasi Anda. Setelah terverifikasi, kembali ke tautan ini dan pilih Terima undangan.");
    } catch (err) { setMessage(firebaseError(err) ?? "Belum dapat mengirim verifikasi."); }
    finally { await clearFirebaseIdentity(); setPending(false); }
  }
  return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 p-6">
    <h1 className="text-2xl font-semibold">Undangan koperasi</h1>
    <p>Masuk menggunakan akun dengan alamat email terverifikasi yang menerima undangan ini.</p>
    {done ? <><p role="status">{message}</p><a className="underline" href={centralLocation("/login")}>Masuk ke koperasi</a></> : <form onSubmit={e => void accept(e)} className="flex flex-col gap-4">
      <AuthMethodSwitch value={method} onChange={setMethod} disabled={pending} />
      {method === "password" ? <><Label htmlFor="invite-email">Email</Label><Input id="invite-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="username" /><Label htmlFor="invite-password">Kata sandi</Label><Input id="invite-password" name="password" type="password" autoComplete="current-password" required /></> : null}
      {method === "password" ? <div className="flex flex-col gap-2"><Button type="button" variant="outline" disabled={pending} onClick={e => void verify(e.currentTarget.form, true)}>Buat akun & kirim verifikasi</Button><Button type="button" variant="ghost" disabled={pending} onClick={e => void verify(e.currentTarget.form, false)}>Kirim ulang verifikasi email</Button></div> : null}
      {message ? <p role="alert">{message}</p> : null}
      <Button disabled={pending || !token.current}>{pending ? "Memeriksa…" : "Terima undangan"}</Button>
      {!token.current ? <p role="alert">Tautan undangan tidak lengkap. Minta tautan baru kepada pengelola.</p> : null}
    </form>}
  </main>;
}
