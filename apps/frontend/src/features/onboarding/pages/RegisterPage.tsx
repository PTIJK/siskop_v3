import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import type { PricingQuote, PricingSelection, PublicPricingCatalog, RegistrationStatus } from "@siskop/types";
import { MarketingShell, Steps } from "../components/MarketingShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthMethodSwitch } from "../components/AuthMethodSwitch";
import { PackagePicker, QuoteSummary } from "../components/PackagePicker";
import { errorMessage, onboardingApi, pricingApi, usePublicPricing } from "../api";
import { clearFirebaseIdentity, firebaseError, identityToken } from "../firebase";
import {
  buildRegistration,
  parseDeepLink,
  requiredCustomFeatures,
  startingSelection,
  stepProblems,
  unitAllowed,
  UNIT_CHOICES,
  type RegistrationForm,
  type UnitChoiceType
} from "../registration";

const STEPS = ["Data koperasi", "Jenis usaha", "Paket", "Akun & ringkasan"] as const;

const EMPTY: RegistrationForm = {
  tenantName: "",
  registrationNo: "",
  type: "KONVENSIONAL",
  address: "",
  unitType: "KSP",
  adminName: "",
  method: "password",
  email: "",
  password: "",
  confirmPassword: ""
};

function WizardSteps({ active }: { active: number }) {
  return (
    <ol className='wizard-steps' aria-label='Langkah pendaftaran'>
      {STEPS.map((label, i) => (
        <li key={label} aria-current={active === i + 1 ? "step" : undefined} data-done={active > i + 1 || undefined}>
          <span>{i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

function Wizard({ catalog, link }: { catalog: PublicPricingCatalog; link: ReturnType<typeof parseDeepLink> }) {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [form, setForm] = useState<RegistrationForm>(EMPTY);
  const [selection, setSelection] = useState<PricingSelection>(() => startingSelection(catalog, link));
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  const set = <K extends keyof RegistrationForm>(key: K, value: RegistrationForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const body = { ...selection, featureKeys: selection.featureKeys ?? [] };
  const quote = useQuery({
    queryKey: ["public-quote", body],
    queryFn: () => pricingApi<PricingQuote>("/quote", body),
    enabled: selection.packageCode !== "",
    placeholderData: keepPreviousData,
    retry: false
  });
  const chosen = catalog.packages.find((p) => p.code === selection.packageCode);

  /** Changing the business type must not leave a package that cannot host it. */
  function changeUnit(type: UnitChoiceType) {
    set("unitType", type);
    const current = catalog.packages.find((p) => p.code === selection.packageCode);
    if (current?.isCustom) {
      const wanted = requiredCustomFeatures(type);
      setSelection({ ...selection, featureKeys: [...new Set([...(selection.featureKeys ?? []), ...wanted])] });
    } else if (current && !unitAllowed(type, current.features)) {
      const next = catalog.packages.find((p) => !p.isCustom && unitAllowed(type, p.features)) ?? catalog.packages.find((p) => p.isCustom);
      if (next) setSelection({ ...selection, packageCode: next.code, featureKeys: next.isCustom ? requiredCustomFeatures(type) : [] });
    }
  }

  function next() {
    const found = stepProblems(step, form, { effectiveFeatures: quote.data?.effectiveFeatures ?? [] });
    if (step === 3 && (quote.isError || !quote.data)) found.push(quote.isError ? errorMessage(quote.error) : "Harga masih dihitung. Tunggu sebentar.");
    setProblems(found);
    if (found.length === 0) setStep((s) => Math.min(4, s + 1) as 1 | 2 | 3 | 4);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const found = stepProblems(4, form, { effectiveFeatures: quote.data?.effectiveFeatures ?? [] });
    setProblems(found);
    if (found.length > 0) return;
    setError("");
    setPending(true);
    submitting.current = true;
    try {
      const idToken = await identityToken(form.method, form.email.trim(), form.password, true);
      await onboardingApi<RegistrationStatus>("/register", buildRegistration(form, selection, idToken));
      navigate("/checkout", { replace: true });
    } catch (err) {
      setError(firebaseError(err) ?? errorMessage(err));
    } finally {
      await clearFirebaseIdentity();
      setPending(false);
      submitting.current = false;
    }
  }

  const free = quote.data !== undefined && Number(quote.data.total) === 0;
  const unit = UNIT_CHOICES.find((u) => u.type === form.unitType);

  return (
    <div className='registration-grid'>
      <div>
        <h1>
          Langkah baru
          <br />
          koperasi Anda.
        </h1>
        <p className='page-intro'>Empat langkah singkat untuk membuka ruang kerja koperasi Anda.</p>
        <WizardSteps active={step} />
        <form onSubmit={submit} className='registration-form' noValidate>
          <fieldset disabled={pending} className='form-fieldset'>
            <legend className='sr-only'>{STEPS[step - 1]}</legend>

            {step === 1 ? (
              <div className='form-fields'>
                <div className='field'>
                  <Label htmlFor='tenantName'>Nama koperasi</Label>
                  <Input id='tenantName' value={form.tenantName} maxLength={150} placeholder='Koperasi Sejahtera Bersama' autoComplete='organization' onChange={(e) => set("tenantName", e.target.value)} />
                </div>
                <div className='field'>
                  <Label htmlFor='registrationNo'>Nomor badan hukum</Label>
                  <Input id='registrationNo' value={form.registrationNo} maxLength={100} placeholder='123/BH/2026' onChange={(e) => set("registrationNo", e.target.value)} />
                </div>
                <div className='field field-wide'>
                  <Label htmlFor='type'>Prinsip operasional</Label>
                  <select id='type' value={form.type} onChange={(e) => set("type", e.target.value as RegistrationForm["type"])}>
                    <option value='KONVENSIONAL'>Konvensional</option>
                    <option value='SYARIAH'>Syariah</option>
                  </select>
                </div>
                <div className='field field-wide'>
                  <Label htmlFor='address'>Alamat koperasi</Label>
                  <Textarea id='address' rows={3} value={form.address} maxLength={500} placeholder='Tulis alamat lengkap koperasi' autoComplete='street-address' onChange={(e) => set("address", e.target.value)} />
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className='unit-choices' role='radiogroup' aria-label='Jenis usaha'>
                {UNIT_CHOICES.map((u) => (
                  <button key={u.type} type='button' role='radio' aria-checked={form.unitType === u.type} className='unit-choice' onClick={() => changeUnit(u.type)}>
                    <strong>{u.label}</strong>
                    <span>{u.hint}</span>
                    {u.feature ? <small>Memerlukan paket Medium ke atas, atau Custom.</small> : null}
                  </button>
                ))}
              </div>
            ) : null}

            {step === 3 ? <PackagePicker catalog={catalog} selection={selection} onChange={setSelection} unitType={form.unitType} /> : null}

            {step === 4 ? (
              <div className='form-fields'>
                <div className='field'>
                  <Label htmlFor='adminName'>Nama pengelola</Label>
                  <Input id='adminName' value={form.adminName} maxLength={100} placeholder='Budi Santoso' autoComplete='name' onChange={(e) => set("adminName", e.target.value)} />
                </div>
                <div className='field field-wide'>
                  <AuthMethodSwitch value={form.method} onChange={(m) => set("method", m)} disabled={pending} />
                  {form.method === "google" ? <p className='form-note'>Email akun akan diambil dari Google saat Anda melanjutkan pendaftaran.</p> : null}
                </div>
                {form.method === "password" ? (
                  <>
                    <div className='field'>
                      <Label htmlFor='adminEmail'>Email pengelola</Label>
                      <Input id='adminEmail' type='email' value={form.email} maxLength={254} placeholder='budi@koperasi.id' autoComplete='email' onChange={(e) => set("email", e.target.value)} />
                    </div>
                    <div className='field'>
                      <Label htmlFor='password'>Kata sandi</Label>
                      <Input id='password' type='password' value={form.password} maxLength={72} placeholder='Minimal 8 karakter' autoComplete='new-password' onChange={(e) => set("password", e.target.value)} />
                    </div>
                    <div className='field'>
                      <Label htmlFor='confirmPassword'>Konfirmasi kata sandi</Label>
                      <Input id='confirmPassword' type='password' value={form.confirmPassword} maxLength={72} placeholder='Ulangi kata sandi' autoComplete='new-password' onChange={(e) => set("confirmPassword", e.target.value)} />
                    </div>
                  </>
                ) : null}
                <dl className='review-list field-wide'>
                  <div>
                    <dt>Koperasi</dt>
                    <dd>{form.tenantName}</dd>
                  </div>
                  <div>
                    <dt>Jenis usaha</dt>
                    <dd>{unit?.label}</dd>
                  </div>
                  <div>
                    <dt>Paket</dt>
                    <dd>
                      {chosen?.name} · {selection.billingCycle === "MONTHLY" ? "bulanan" : "tahunan"}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : null}
          </fieldset>

          {problems.length > 0 ? (
            <ul className='form-error' role='alert'>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          {error ? (
            <p className='form-error' role='alert'>
              {error}
            </p>
          ) : null}

          <div className='wizard-nav'>
            {step > 1 ? (
              <Button type='button' variant='outline' size='lg' disabled={pending} onClick={() => { setProblems([]); setStep((s) => (s - 1) as 1 | 2 | 3 | 4); }}>
                <ArrowLeft /> Kembali
              </Button>
            ) : null}
            {step < 4 ? (
              <Button type='button' size='lg' onClick={next}>
                Lanjut <ArrowRight />
              </Button>
            ) : (
              <Button size='lg' type='submit' disabled={pending}>
                {pending ? (
                  <>
                    <Loader2 className='animate-spin' /> Menyiapkan akun…
                  </>
                ) : free ? (
                  <>
                    Daftar sekarang <ArrowRight />
                  </>
                ) : (
                  <>
                    Daftar & lihat tagihan <ArrowRight />
                  </>
                )}
              </Button>
            )}
          </div>
          <p className='form-note'>
            Sudah mendaftar? <Link to='/checkout/resume'>Lanjutkan pendaftaran</Link>
          </p>
        </form>
      </div>

      <aside className='registration-aside'>
        <div className='order-summary'>
          <h2>Pilihan Anda</h2>
          <h3>{chosen?.name ?? "—"}</h3>
          <QuoteSummary quote={quote.data} taxRate={catalog.settings.taxRate} loading={quote.isFetching} />
          {quote.isError ? <p className='form-error'>{errorMessage(quote.error)}</p> : null}
          <p className='payment-note'>
            {free ? "Koperasi aktif segera setelah mendaftar." : "Koperasi aktif setelah pembayaran faktur dikonfirmasi."}
          </p>
        </div>
      </aside>
    </div>
  );
}

export default function RegisterPage() {
  const [search] = useSearchParams();
  const catalog = usePublicPricing();
  return (
    <MarketingShell>
      <main id='main-content' className='registration content-width'>
        <Steps active={2} />
        {catalog.isPending ? (
          <Skeleton className='h-96 w-full' />
        ) : catalog.isError ? (
          <div className='catalog-empty'>
            <h1>Paket belum dapat dimuat.</h1>
            <p>{errorMessage(catalog.error)}</p>
            <Button onClick={() => void catalog.refetch()}>Coba lagi</Button>
          </div>
        ) : (
          <Wizard catalog={catalog.data} link={parseDeepLink(search, catalog.data)} />
        )}
      </main>
    </MarketingShell>
  );
}
