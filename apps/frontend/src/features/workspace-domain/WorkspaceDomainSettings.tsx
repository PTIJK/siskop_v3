import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TenantDomainSettings } from "@siskop/types";
import { apiFetch, apiPut } from "@/api/client";
import { useAuth } from "@/stores/auth";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canonicalWorkspaceUrl, tenantSlug } from "./host";
import { identityToken, clearFirebaseIdentity, firebaseError } from "../onboarding/firebase";

const REASONS = {
  unavailable: "Alamat workspace sedang disiapkan. Pengubahan belum tersedia.",
  inactive: "Workspace belum aktif.",
  package: "Paket aktif Anda belum mendukung perubahan subdomain. Hubungi pengelola untuk meningkatkan paket.",
  cooldown: "Alamat dapat diubah satu kali setiap 365 hari.",
  permission: "Hanya admin dengan izin mengubah konfigurasi yang dapat mengganti alamat."
};
const date = (value: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(value));

export function WorkspaceDomainSettings() {
  const user = useAuth(s => s.user);
  const cache = useQueryClient();
  const [slug, setSlug] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const key = ["tenant-domain", user?.tenantId];
  const query = useQuery({ queryKey: key, queryFn: () => apiFetch<TenantDomainSettings>("/tenant-domain") });
  const settings = query.data;
  const nextSlug = slug.trim().toLowerCase();
  const provider = user?.authProvider === "google.com" ? "google" : "password";

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !user) return;
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    event.currentTarget.reset();
    setPending(true); setError("");
    try {
      const idToken = await identityToken(provider, user.email, password);
      const result = await apiPut<TenantDomainSettings>("/tenant-domain", { slug: nextSlug, idToken });
      cache.setQueryData(key, result);
      setConfirm(false); setSlug(""); setNotice("Alamat workspace berhasil diubah. Alamat lama tetap mengarah ke koperasi Anda.");
      if (tenantSlug()) {
        useAuth.getState().clear();
        window.location.assign(canonicalWorkspaceUrl(result.loginUrl));
      }
    } catch (err) { setError(firebaseError(err) ?? (err instanceof Error ? err.message : "Perubahan belum berhasil.")); }
    finally { await clearFirebaseIdentity().catch(() => {}); setPending(false); }
  }
  if (query.isPending) return <Skeleton className="h-64 w-full" aria-label="Memuat alamat workspace" />;
  if (query.isError) return <div role="alert" className="flex flex-col gap-3"><p>{query.error.message}</p><Button variant="outline" onClick={() => void query.refetch()}>Coba lagi</Button></div>;
  if (!settings) return null;
  return <Card>
    <CardHeader><CardTitle>Alamat workspace</CardTitle><CardDescription>Bagikan alamat ini kepada pengguna koperasi Anda.</CardDescription></CardHeader>
    <CardContent className="flex flex-col gap-6">
      <a href={settings.loginUrl} className="break-all text-primary underline">{settings.loginUrl.replace(/\/login$/, "")}</a>
      <p className="text-sm text-muted-foreground">Perubahan alamat mempertahankan anggota, transaksi, dan akses pengguna. Alamat lama tetap dicadangkan untuk koperasi Anda.</p>
      {notice ? <p role="status">{notice}</p> : null}
      {settings.blockedReason ? <p role="status">{REASONS[settings.blockedReason]}</p> : null}
      {settings.nextChangeAt ? <p className="text-sm">Perubahan berikutnya: {date(settings.nextChangeAt)} WIB.</p> : null}
      {settings.canRename ? <form onSubmit={event => { event.preventDefault(); setError(""); setConfirm(true); }} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <Label htmlFor="workspace-slug">Alamat baru</Label>
          <Input id="workspace-slug" value={slug} onChange={event => setSlug(event.target.value.toLowerCase())} autoComplete="off"
            maxLength={63} required pattern={'[a-z0-9]([a-z0-9\\-]*[a-z0-9])?'} placeholder="nama-koperasi" aria-describedby="workspace-address-preview" />
          <p id="workspace-address-preview" className="break-all text-sm text-muted-foreground">{nextSlug || "nama-koperasi"}.{settings.baseDomain}</p>
        </fieldset>
        <Button type="submit" disabled={!nextSlug || nextSlug === settings.slug} className="self-start">Tinjau perubahan</Button>
      </form> : null}
      {settings.history.length ? <div className="flex flex-col gap-2"><h3 className="font-medium">Riwayat alamat</h3><ul className="flex flex-col gap-2 text-sm">{settings.history.map(item =>
        <li key={item.changedAt} className="break-words">{item.oldSlug} → {item.newSlug} · {date(item.changedAt)} WIB</li>)}</ul></div> : null}
    </CardContent>
    <CardFooter><p className="text-sm text-muted-foreground">Penggantian subdomain tersedia sekali setiap 365 hari untuk paket yang mendukungnya.</p></CardFooter>
    <Dialog open={confirm} onOpenChange={open => { if (!pending) setConfirm(open); }}>
      <DialogContent><DialogHeader><DialogTitle>Konfirmasi alamat baru</DialogTitle><DialogDescription>
        Alamat menjadi {nextSlug}.{settings.baseDomain}. Anda dapat menggantinya lagi setelah 365 hari. Masuk kembali untuk mengonfirmasi.
      </DialogDescription></DialogHeader>
        <form onSubmit={rename} className="flex flex-col gap-4">
          <p className="break-all text-sm">{user?.email}</p>
          {provider === "password" ? <fieldset className="flex flex-col gap-2"><Label htmlFor="workspace-password">Kata sandi akun Anda</Label>
            <Input id="workspace-password" name="password" type="password" autoComplete="current-password" required disabled={pending} /></fieldset> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <Button disabled={pending} type="submit">{pending ? "Menyimpan…" : provider === "google" ? "Konfirmasi dengan Google" : "Konfirmasi perubahan"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  </Card>;
}
