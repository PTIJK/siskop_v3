import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import type { PricingQuote, PricingSelection, PublicPricingCatalog, RegistrationStatus } from "@siskop/types";
import { MarketingShell } from "../components/MarketingShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthMethodSwitch } from "../components/AuthMethodSwitch";
import { DocumentAutofill } from "../components/DocumentAutofill";
import { PackagePicker, QuoteSummary } from "../components/PackagePicker";
import { track } from "@/lib/analytics";
import { errorMessage, onboardingApi, pricingApi, usePublicPricing, useReferralCheck } from "../api";
import { clearFirebaseIdentity, firebaseError, identityToken } from "../firebase";
import {
  buildRegistration,
  parseDeepLink,
  recalledReferral,
  rememberReferral,
  requiredCustomFeatures,
  startingSelection,
  stepProblems,
  unitAllowed,
  UNIT_CHOICES,
  type RegistrationForm,
  type UnitChoiceType
} from "../registration";

const STEPS = ["Data koperasi", "Akun pengurus", "Konfirmasi"] as const;
const STEP_COPY = [
  { title: "Daftarkan koperasi Anda", description: "Isi nama dan nomor badan hukum sesuai dokumen koperasi." },
  { title: "Siapkan akun pengurus", description: "Akun ini digunakan untuk mengelola koperasi dan melihat status pendaftaran." },
  { title: "Periksa sebelum mendaftar", description: "Pastikan data koperasi, paket, dan periode tagihan sudah sesuai." }
] as const;
type Step = 1 | 2 | 3;

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
  confirmPassword: "",
  referralCode: ""
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
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<RegistrationForm>(() => ({ ...EMPTY, referralCode: link.referralCode ?? recalledReferral() ?? "" }));
  const [cooperativeKind, setCooperativeKind] = useState<"KSP" | "KSU">("KSP");
  const [nik, setNik] = useState("");
  const [nikTouched, setNikTouched] = useState(false);
  const [editingPlan, setEditingPlan] = useState(false);
  const referral = useReferralCheck(form.referralCode);
  useEffect(() => {
    if (link.referralCode) rememberReferral(link.referralCode);
  }, [link.referralCode]);
  const [selection, setSelection] = useState<PricingSelection>(() => startingSelection(catalog, link));
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const problemSummary = useRef<HTMLUListElement>(null);
  const nikInvalid = nik !== "" && !/^\d{16}$/.test(nik);
  const copy = STEP_COPY[step - 1]!;

  useEffect(() => {
    if (problems.length) problemSummary.current?.focus();
  }, [problems]);

  const set = <K extends keyof RegistrationForm>(key: K, value: RegistrationForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const body = { ...selection, featureKeys: selection.featureKeys ?? [] };
  const quote = useQuery({
    queryKey: ["public-quote", body],
    queryFn: () => pricingApi<PricingQuote>("/quote", body),
    enabled: selection.packageCode !== "",
    retry: false
  });
  const chosen = catalog.packages.find((p) => p.code === selection.packageCode);

  function changeUnit(type: UnitChoiceType) {
    set("unitType", type);
    if (chosen?.isCustom) {
      const wanted = requiredCustomFeatures(type);
      setSelection({ ...selection, featureKeys: [...new Set([...(selection.featureKeys ?? []), ...wanted])] });
    }
  }

  function go(next: Step) {
    setProblems([]);
    setError("");
    setStep(next);
    requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: "start" });
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const features = { effectiveFeatures: quote.data?.effectiveFeatures ?? [] };
    if (step !== 3) {
      const found = stepProblems(step === 1 ? 1 : 4, form, features);
      if (step === 2 && nikInvalid) found.unshift("Masukkan 16 digit NIK pengurus atau kosongkan kolom ini.");
      if (found.length) setProblems(found);
      else go(step === 1 ? 2 : 3);
      return;
    }
    if (editingPlan || !quote.data || quote.isError || quote.isFetching || !unitAllowed(form.unitType, features.effectiveFeatures)) return;
    setError("");
    setPending(true);
    submitting.current = true;
    try {
      const idToken = await identityToken(form.method, form.email.trim(), form.password, true);
      await onboardingApi<RegistrationStatus>("/register", buildRegistration(form, selection, idToken));
      track("form_submit", { form: "register", package: selection.packageCode });
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
  const compatible = quote.data && unitAllowed(form.unitType, quote.data.effectiveFeatures);
  const cycle = selection.billingCycle === "MONTHLY" ? "Bulanan" : "Tahunan";
  const unit = UNIT_CHOICES.find((u) => u.type === form.unitType);
  const quoteDetails = (
    <>
      <QuoteSummary quote={quote.data} taxRate={catalog.settings.taxRate} loading={quote.isFetching} />
      {quote.isError ? <div><p className='form-error' role='alert'>{errorMessage(quote.error)}</p><Button type='button' variant='outline' onClick={() => void quote.refetch()}>Hitung ulang tagihan</Button></div> : null}
      {quote.data ? <p className='payment-note'>{free ? "Paket ini langsung aktif setelah pendaftaran." : "Paket aktif setelah pembayaran dikonfirmasi."}</p> : null}
    </>
  );

  return (
    <div className='registration-grid'>
      <div>
        <WizardSteps active={step} />
        <h1 ref={heading} tabIndex={-1}>{copy.title}</h1>
        <p className='page-intro'>{copy.description}</p>
        {step < 3 && chosen ? <p className='form-note registration-plan-note'>Paket pilihan Anda: {chosen.name} · {cycle}</p> : null}
        <form onSubmit={submit} className='registration-form' noValidate>
          <fieldset disabled={pending} className='form-fieldset'>
            <legend className='sr-only'>{STEPS[step - 1]}</legend>

            {step === 1 ? (
              <div className='form-fields'>
                <fieldset className='field field-wide registration-kind'>
                  <legend>Jenis koperasi</legend>
                  <div className='unit-choices'>
                    <label className='unit-choice'>
                      <strong><input type='radio' name='cooperative-kind' checked={cooperativeKind === "KSP"} onChange={() => { setCooperativeKind("KSP"); changeUnit("KSP"); }} /> KSP</strong>
                      <span>Koperasi Simpan Pinjam</span>
                    </label>
                    <label className='unit-choice'>
                      <strong><input type='radio' name='cooperative-kind' checked={cooperativeKind === "KSU"} onChange={() => setCooperativeKind("KSU")} /> KSU</strong>
                      <span>Koperasi Serba Usaha</span>
                    </label>
                  </div>
                </fieldset>
                {cooperativeKind === "KSU" ? (
                  <div className='field field-wide'>
                    <Label htmlFor='first-unit'>Unit usaha pertama</Label>
                    <select id='first-unit' value={form.unitType} onChange={(event) => changeUnit(event.target.value as UnitChoiceType)}>
                      {UNIT_CHOICES.map((choice) => <option key={choice.type} value={choice.type}>{choice.label}</option>)}
                    </select>
                    <p className='form-note'>Mulai dengan satu unit. Unit lain dapat ditambahkan setelah koperasi aktif, sesuai cakupan paket.</p>
                  </div>
                ) : null}
                <DocumentAutofill kind='cooperative' onRead={(fields) => {
                  if ("tenantName" in fields) setForm((previous) => ({
                    ...previous,
                    tenantName: fields.tenantName ?? previous.tenantName,
                    registrationNo: fields.registrationNo ?? previous.registrationNo,
                    address: fields.address ?? previous.address
                  }));
                }} />
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
                <div className='field field-wide'>
                  <Label htmlFor='referralCode'>Kode referral (opsional)</Label>
                  <Input id='referralCode' value={form.referralCode} maxLength={30} placeholder='NEX-XXXXXX' autoComplete='off' onChange={(e) => set("referralCode", e.target.value)} />
                  {form.referralCode.trim() === "" ? null : referral.checking ? (
                    <p className='form-note'>Memeriksa kode…</p>
                  ) : referral.current && referral.data?.valid ? (
                    <p className='form-note' role='status'>
                      Direferensikan oleh {referral.data.partnerName}
                    </p>
                  ) : referral.current && referral.data ? (
                    <p className='form-error' role='alert'>
                      Kode tidak ditemukan atau tidak aktif. Periksa kembali atau kosongkan kolom ini.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className='form-fields'>
                <DocumentAutofill kind='ktp' onRead={(fields) => {
                  if ("adminName" in fields && fields.adminName) set("adminName", fields.adminName);
                  if ("nik" in fields && fields.nik) { setNik(fields.nik); setNikTouched(true); }
                }} />
                <div className='field'>
                  <Label htmlFor='adminName'>Nama pengurus</Label>
                  <Input id='adminName' value={form.adminName} maxLength={100} autoComplete='name' onChange={(e) => set("adminName", e.target.value)} />
                </div>
                <div className='field'>
                  <Label htmlFor='nik'>NIK pengurus (opsional)</Label>
                  <Input id='nik' inputMode='numeric' autoComplete='off' maxLength={16} value={nik}
                    aria-describedby='nik-note' aria-invalid={nikTouched && nikInvalid}
                    onBlur={() => setNikTouched(true)} onChange={(event) => setNik(event.target.value)} />
                  <p id='nik-note' className='form-note'>
                    {nikTouched && nikInvalid ? "NIK harus terdiri dari 16 digit angka." : "Pengecekan format dilakukan di perangkat Anda. NIK tidak dikirim."}
                  </p>
                </div>
                <div className='field field-wide'>
                  <AuthMethodSwitch value={form.method} onChange={(m) => set("method", m)} disabled={pending} />
                  {form.method === "google" ? <p className='form-note'>Pilih akun Google saat mengirim pendaftaran.</p> : null}
                </div>
                {form.method === "password" ? (
                  <>
                    <div className='field'>
                      <Label htmlFor='adminEmail'>Email pengurus</Label>
                      <Input id='adminEmail' type='email' value={form.email} maxLength={254} autoComplete='email' onChange={(e) => set("email", e.target.value)} />
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
              </div>
            ) : null}

            {step === 3 ? (
              <div className='registration-review'>
                <dl className='review-list'>
                  <div>
                    <dt>Koperasi</dt>
                    <dd>{form.tenantName}</dd>
                  </div>
                  <div>
                    <dt>Nomor badan hukum</dt>
                    <dd>{form.registrationNo}</dd>
                  </div>
                  <div>
                    <dt>Jenis koperasi</dt>
                    <dd>{cooperativeKind}{cooperativeKind === "KSU" ? ` · Unit awal: ${unit?.label ?? ""}` : ""}</dd>
                  </div>
                  <div>
                    <dt>Pengurus</dt>
                    <dd>{form.adminName}{form.method === "password" ? ` · ${form.email}` : " · Masuk dengan Google"}</dd>
                  </div>
                  <div>
                    <dt>Paket</dt>
                    <dd>
                      {chosen?.name} · {cycle}
                    </dd>
                  </div>
                </dl>
                <p className='form-note'>Nomor badan hukum dicek terhadap pendaftaran yang sudah ada di SISKOP saat Anda mengirim formulir.</p>
                <Button type='button' variant='outline' aria-expanded={editingPlan} aria-controls='registration-plan-editor'
                  onClick={() => setEditingPlan((current) => !current)}>
                  {editingPlan ? "Selesai mengubah paket" : "Ubah paket atau periode"}
                </Button>
                <div id='registration-plan-editor' hidden={!editingPlan}>
                  {editingPlan ? <PackagePicker catalog={catalog} selection={selection} onChange={setSelection} unitType={form.unitType} /> : null}
                </div>
                {quote.data && !compatible ? <p className='form-error' role='alert'>Paket ini belum mendukung unit {unit?.label}. Pilih paket lain atau ubah unit pertama.</p> : null}
                <div className='registration-mobile-quote order-summary'>{quoteDetails}</div>
              </div>
            ) : null}
          </fieldset>

          {problems.length > 0 ? (
            <ul className='form-error' role='alert' ref={problemSummary} tabIndex={-1}>
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
              <Button type='button' variant='outline' size='lg' disabled={pending} onClick={() => go(step === 3 ? 2 : 1)}>
                <ArrowLeft /> Kembali
              </Button>
            ) : null}
            {step < 3 ? (
              <Button type='submit' size='lg'>
                {step === 1 ? "Lanjut ke akun pengurus" : "Periksa pendaftaran"} <ArrowRight />
              </Button>
            ) : (
              <Button size='lg' type='submit' disabled={pending || editingPlan || quote.isFetching || quote.isError || !compatible}>
                {pending ? (
                  <>
                    <Loader2 className='animate-spin' /> Menyiapkan akun…
                  </>
                ) : free ? (
                  <>
                    Daftarkan koperasi <ArrowRight />
                  </>
                ) : (
                  <>
                    Daftarkan koperasi dan lihat tagihan <ArrowRight />
                  </>
                )}
              </Button>
            )}
          </div>
          <p className='form-note'>
            Sudah mendaftar? <Link to='/login'>Masuk</Link>
          </p>
        </form>
      </div>

      <aside className='registration-aside'>
        <div className='order-summary'>
          <h2>Ringkasan paket</h2>
          {chosen ? <h3>{chosen.name} · {cycle}</h3> : null}
          {quoteDetails}
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
        {catalog.isPending ? (
          <Skeleton className='h-96 w-full' />
        ) : catalog.isError ? (
          <div className='catalog-empty'>
            <h1>Paket belum dapat dimuat.</h1>
            <p>{errorMessage(catalog.error)}</p>
            <Button onClick={() => void catalog.refetch()}>Coba lagi</Button>
          </div>
        ) : catalog.data.packages.length === 0 ? (
          <div className='catalog-empty'>
            <h1>Pendaftaran belum dibuka</h1>
            <p>Belum ada paket yang tersedia. Silakan cek kembali nanti.</p>
            <Link to='/'>Kembali ke beranda</Link>
          </div>
        ) : (
          <Wizard catalog={catalog.data} link={parseDeepLink(search, catalog.data)} />
        )}
      </main>
    </MarketingShell>
  );
}
