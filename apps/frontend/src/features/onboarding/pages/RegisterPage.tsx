import { useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, LockKeyhole, Loader2 } from "lucide-react";
import type { OnboardingRegistration, OnboardingStatus, PackageCatalog } from "@siskop/types";
import { MarketingShell, Steps } from "../components/MarketingShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { PackageFeatures } from "../components/PackageFeatures";
import { errorMessage, onboardingApi, rupiah, unitNames } from "../api";

import { AuthMethodSwitch } from "../components/AuthMethodSwitch";
import { identityToken, clearFirebaseIdentity, firebaseError, type AuthMethod } from "../firebase";

export default function RegisterPage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [method, setMethod] = useState<AuthMethod>("password");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const submitting = useRef(false);
  const catalog = useQuery({
    queryKey: ["public-packages"],
    queryFn: () => onboardingApi<PackageCatalog>("/packages")
  });
  const pkg = catalog.data?.packages.find((item) => item.id === search.get("package"));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !pkg) return;
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (method === "password" && password !== form.get("confirmPassword")) {
      setPasswordError(true);
      setError("Konfirmasi kata sandi belum cocok.");
      return;
    }
    setPasswordError(false);
    setError("");
    setPending(true);
    submitting.current = true;
    const unitType = value("unitType") as keyof typeof unitNames;
    const input: Omit<OnboardingRegistration, "idToken"> = {
      packageId: pkg.id,
      tenantName: value("tenantName"),
      slug: value("slug"),
      registrationNo: value("registrationNo"),
      address: value("address"),
      type: value("type") as "SYARIAH" | "KONVENSIONAL",
      adminName: value("adminName"),
      firstUnit: { type: unitType, name: unitNames[unitType] }
    };
    try {
      const idToken = await identityToken(method, value("adminEmail"), password, true);
      await onboardingApi<OnboardingStatus>("/register", { ...input, idToken });
      // Navigate before creating the provider session. A recoverable status page
      // already exists if the provider request or the external redirect fails.
      navigate("/checkout?start=1", { replace: true });
    } catch (err) {
      setError(firebaseError(err) ?? errorMessage(err));
    } finally {
      await clearFirebaseIdentity();
      setPending(false);
      submitting.current = false;
    }
  }
  return (
    <MarketingShell>
      <main id='main-content' className='registration content-width'>
        <Steps active={2} />
        {catalog.isPending ? (
          <Skeleton className='h-96 w-full' />
        ) : !pkg ? (
          <div className='catalog-empty'>
            <h1>{catalog.isError ? "Paket belum dapat dimuat." : "Pilih paket Anda terlebih dahulu."}</h1>
            <p>{catalog.isError ? errorMessage(catalog.error) : "Paket ini mungkin sudah tidak tersedia."}</p>
            <Button asChild>
              <Link to='/#paket'>Lihat paket</Link>
            </Button>
          </div>
        ) : (
          <div className='registration-grid'>
            <div>
              <h1>
                Langkah baru
                <br />
                koperasi Anda.
              </h1>
              <p className='page-intro'>Lengkapi data koperasi dan buat akun pengelola.</p>
              <form onSubmit={submit} className='registration-form'>
                <fieldset disabled={pending} className='form-fieldset'>
                  <legend className='sr-only'>Data koperasi dan pengelola</legend>
                  <div className='form-fields'>
                    <div className='field'>
                      <Label htmlFor='tenantName'>Nama koperasi</Label>
                      <Input
                        id='tenantName'
                        name='tenantName'
                        required
                        minLength={2}
                        maxLength={150}
                        placeholder='Koperasi Sejahtera Bersama'
                        autoComplete='organization'
                      />
                    </div>
                    <div className='field'>
                      <Label htmlFor='slug'>Alamat workspace</Label>
                      <Input
                        id='slug'
                        name='slug'
                        required
                        maxLength={63}
                        pattern='[a-z0-9]([a-z0-9-]*[a-z0-9])?'
                        placeholder='sejahtera-bersama'
                        aria-describedby='slug-help'
                        autoCapitalize='none'
                        autoCorrect='off'
                      />
                      <small id='slug-help'>Huruf kecil, angka, dan tanda hubung.</small>
                    </div>
                    <div className='field'>
                      <Label htmlFor='registrationNo'>Nomor badan hukum</Label>
                      <Input
                        id='registrationNo'
                        name='registrationNo'
                        required
                        maxLength={100}
                        placeholder='123/BH/2026'
                      />
                    </div>
                    <div className='field'>
                      <Label htmlFor='unitType'>Jenis koperasi</Label>
                      <select id='unitType' name='unitType' required defaultValue='KSP'>
                        {Object.entries(unitNames).map(([id, name]) => (
                          <option value={id} key={id}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className='field field-wide'>
                      <Label htmlFor='type'>Prinsip operasional</Label>
                      <select id='type' name='type' defaultValue='KONVENSIONAL'>
                        <option value='KONVENSIONAL'>Konvensional</option>
                        <option value='SYARIAH'>Syariah</option>
                      </select>
                    </div>
                    <div className='field field-wide'>
                      <Label htmlFor='address'>Alamat koperasi</Label>
                      <Textarea
                        id='address'
                        name='address'
                        required
                        minLength={5}
                        maxLength={500}
                        placeholder='Tulis alamat lengkap koperasi'
                        autoComplete='street-address'
                        rows={3}
                      />
                    </div>
                    <div className='field'>
                      <Label htmlFor='adminName'>Nama pengelola</Label>
                      <Input
                        id='adminName'
                        name='adminName'
                        required
                        minLength={2}
                        maxLength={100}
                        placeholder='Budi Santoso'
                        autoComplete='name'
                      />
                    </div>
                    <div className='field field-wide'>
                      <AuthMethodSwitch value={method} onChange={setMethod} disabled={pending} />
                      {method === "google" ? <p className='form-note'>Email akun akan diambil dari Google saat Anda melanjutkan pendaftaran.</p> : null}
                    </div>
                    {method === "password" ? <>
                    <div className='field'>
                      <Label htmlFor='adminEmail'>Email pengelola</Label>
                      <Input
                        id='adminEmail'
                        name='adminEmail'
                        required
                        type='email'
                        maxLength={254}
                        placeholder='budi@koperasi.id'
                        autoComplete='email'
                      />
                    </div>
                    <div className='field'>
                      <Label htmlFor='password'>Kata sandi</Label>
                      <Input
                        id='password'
                        name='password'
                        type='password'
                        required
                        minLength={8}
                        maxLength={72}
                        placeholder='Minimal 8 karakter'
                        autoComplete='new-password'
                      />
                    </div>
                    <div className='field' data-invalid={passwordError || undefined}>
                      <Label htmlFor='confirmPassword'>Konfirmasi kata sandi</Label>
                      <Input
                        id='confirmPassword'
                        name='confirmPassword'
                        type='password'
                        required
                        minLength={8}
                        maxLength={72}
                        placeholder='Ulangi kata sandi'
                        autoComplete='new-password'
                        aria-invalid={passwordError}
                        aria-describedby={passwordError ? "register-error" : undefined}
                      />
                    </div>
                    </> : null}
                  </div>
                </fieldset>
                <p className='form-note'>Setelah mendaftar, lanjutkan pembayaran Xendit. Setelah pembayaran berhasil, masuk untuk membuka dashboard.</p>
                {error ? (
                  <p id='register-error' className='form-error' role='alert'>
                    {error}
                  </p>
                ) : null}
                {!catalog.data?.checkoutAvailable ? (
                  <p className='form-error' role='status'>
                    Pendaftaran berbayar sedang disiapkan. Silakan coba kembali nanti.
                  </p>
                ) : null}
                <Button size='lg' type='submit' disabled={pending || !catalog.data?.checkoutAvailable}>
                  {pending ? (
                    <>
                      <Loader2 className='animate-spin' /> Menyiapkan akun…
                    </>
                  ) : (
                    <>
                      Daftar & lanjut bayar <ArrowUpRight />
                    </>
                  )}
                </Button>
                <p className='form-note'>
                  Sudah mendaftar? <Link to='/checkout/resume'>Lanjutkan pembayaran</Link>
                </p>
              </form>
            </div>
            <aside className='registration-aside'>
              <div className='order-summary'>
                <h2>Pilihan Anda</h2>
                <h3>{pkg.name}</h3>
                <p className='summary-price'>
                  {rupiah(pkg.price)} <span>/ bulan</span>
                </p>
                <PackageFeatures pkg={pkg} />
                <div className='summary-total'>
                  <span>Total pembayaran</span>
                  <strong>{rupiah(pkg.price)}</strong>
                  <p>
                    Satu bulan akses.
                    <br />
                    Tidak diperpanjang otomatis.
                  </p>
                </div>
                <p className='payment-note'>
                  <LockKeyhole size={15} /> Pembayaran diproses melalui Xendit.
                </p>
              </div>
              <h2 className='aside-statement'>
                Mulai tertata.
                <br />
                <span>Siap bertumbuh.</span>
              </h2>
            </aside>
          </div>
        )}
      </main>
    </MarketingShell>
  );
}
