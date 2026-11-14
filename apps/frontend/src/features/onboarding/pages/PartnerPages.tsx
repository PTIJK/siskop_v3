import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { MarketingShell } from "../components/MarketingShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { track } from "@/lib/analytics";
import { errorMessage, partnersApi } from "../api";
import { applicationProblems, buildApplication, EMPTY_APPLICATION, type PartnerApplicationForm } from "../partner";

const HOW = [
  ["Daftar", "Isi formulir singkat. Tim kami meninjau dalam 2×24 jam kerja."],
  ["Bagikan kode", "Setelah disetujui, Anda menerima kode referral dan tautan pendaftaran lewat email."],
  ["Koperasi mendaftar", "Koperasi yang mendaftar dengan kode Anda otomatis tercatat sebagai referensi Anda."],
  ["Terima komisi", "Komisi dihitung dari setiap tagihan yang dibayar koperasi tersebut, lalu ditransfer ke rekening Anda."]
] as const;

const FAQ = [
  ["Berapa komisinya?", "Komisi standar 20% dari nilai tagihan (sebelum PPN) yang dibayar koperasi, selama 12 bulan sejak koperasi mendaftar. Ketentuan tiap mitra tercantum di email persetujuan."],
  ["Kapan komisi dibayar?", "Komisi dihitung otomatis saat tagihan dibayar dan ditransfer ke rekening Anda dalam satu periode pembayaran bulanan."],
  ["Apakah perlu punya badan usaha?", "Tidak. Perorangan maupun lembaga dapat menjadi mitra."],
  ["Data apa yang diperlukan?", "NIK dan rekening bank untuk pembayaran komisi. Data hanya dapat dilihat oleh tim SISKOP."]
] as const;

export function PartnerProgramPage() {
  return (
    <MarketingShell>
      <main id='main-content' className='registration content-width'>
        <h1>
          Ajak koperasi bergabung,
          <br />
          terima komisi berulang.
        </h1>
        <p className='page-intro'>
          Program mitra SISKOP untuk agen, konsultan, dan siapa pun yang dekat dengan koperasi. Satu kode referral, komisi 20% selama 12 bulan.
        </p>
        <Button asChild size='lg'>
          <Link to='/mitra/daftar'>
            Daftar jadi mitra <ArrowRight />
          </Link>
        </Button>

        <h2>Cara kerjanya</h2>
        <ol className='review-list'>
          {HOW.map(([title, body], index) => (
            <li key={title}>
              <strong>
                {index + 1}. {title}
              </strong>
              <p>{body}</p>
            </li>
          ))}
        </ol>

        <h2>Pertanyaan umum</h2>
        <dl className='review-list'>
          {FAQ.map(([question, answer]) => (
            <div key={question}>
              <dt>{question}</dt>
              <dd>{answer}</dd>
            </div>
          ))}
        </dl>
      </main>
    </MarketingShell>
  );
}

export function PartnerApplyPage() {
  const [form, setForm] = useState<PartnerApplicationForm>(EMPTY_APPLICATION);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const submitting = useRef(false);
  const set = <K extends keyof PartnerApplicationForm>(key: K, value: PartnerApplicationForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const found = applicationProblems(form);
    setProblems(found);
    if (found.length > 0) return;
    setError("");
    setPending(true);
    submitting.current = true;
    try {
      await partnersApi<{ received: true }>("/apply", buildApplication(form));
      track("form_submit", { form: "partner_apply" });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
      submitting.current = false;
    }
  }

  const text = (id: keyof PartnerApplicationForm, label: string, props: { placeholder?: string; type?: string; max?: number; autoComplete?: string; wide?: boolean } = {}) => (
    <div className={props.wide ? "field field-wide" : "field"}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={props.type} value={form[id] as string} maxLength={props.max ?? 100} placeholder={props.placeholder} autoComplete={props.autoComplete} onChange={(e) => set(id, e.target.value as never)} />
    </div>
  );

  return (
    <MarketingShell>
      <main id='main-content' className='registration content-width'>
        {done ? (
          <div className='catalog-empty' role='status'>
            <CheckCircle2 aria-hidden='true' />
            <h1>Pendaftaran diterima.</h1>
            <p>Kami akan meninjau dalam 2×24 jam kerja dan mengabari Anda lewat email.</p>
            <Button asChild variant='outline'>
              <Link to='/mitra'>Kembali ke program mitra</Link>
            </Button>
          </div>
        ) : (
          <>
            <h1>Daftar jadi mitra SISKOP</h1>
            <p className='page-intro'>Lengkapi data berikut. NIK dan rekening dipakai untuk pembayaran komisi dan hanya dilihat tim SISKOP.</p>
            <form onSubmit={submit} className='registration-form' noValidate>
              <fieldset disabled={pending} className='form-fieldset'>
                <legend className='sr-only'>Formulir mitra</legend>
                <div className='form-fields'>
                  {text("name", "Nama lengkap", { placeholder: "Budi Santoso", autoComplete: "name" })}
                  {text("email", "Email", { type: "email", placeholder: "budi@email.com", autoComplete: "email", max: 254 })}
                  {text("phone", "Nomor WhatsApp", { placeholder: "0812 3456 7890", autoComplete: "tel", max: 20 })}
                  {text("city", "Kota", { autoComplete: "address-level2" })}
                  {text("province", "Provinsi", { autoComplete: "address-level1" })}
                  {text("ktpNo", "NIK (16 digit)", { placeholder: "3578010101900001", max: 16 })}
                  {text("npwp", "NPWP (opsional)", { max: 25 })}
                  {text("bankName", "Nama bank", { placeholder: "BCA" })}
                  {text("bankAccountNo", "Nomor rekening", { max: 25 })}
                  {text("bankAccountName", "Nama pemilik rekening")}
                  <div className='field field-wide'>
                    <Label htmlFor='salesPlan'>Bagaimana Anda akan memperkenalkan SISKOP? (opsional)</Label>
                    <Textarea id='salesPlan' rows={3} value={form.salesPlan} maxLength={1000} onChange={(e) => set("salesPlan", e.target.value)} />
                  </div>
                  {/* Honeypot: invisible to people and to assistive tech; bots fill it. */}
                  <div aria-hidden='true' style={{ position: "absolute", left: "-10000px" }}>
                    <label htmlFor='website'>Website</label>
                    <input id='website' tabIndex={-1} autoComplete='off' value={form.website} onChange={(e) => set("website", e.target.value)} />
                  </div>
                  <div className='field field-wide'>
                    <label className='form-note' htmlFor='acceptTerms'>
                      <input id='acceptTerms' type='checkbox' checked={form.acceptTerms} onChange={(e) => set("acceptTerms", e.target.checked)} /> Saya menyetujui syarat dan ketentuan program mitra SISKOP dan pemrosesan data pribadi saya untuk pembayaran komisi.
                    </label>
                  </div>
                </div>
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
                <Button size='lg' type='submit' disabled={pending}>
                  {pending ? (
                    <>
                      <Loader2 className='animate-spin' /> Mengirim…
                    </>
                  ) : (
                    <>
                      Kirim pendaftaran <ArrowRight />
                    </>
                  )}
                </Button>
              </div>
            </form>
          </>
        )}
      </main>
    </MarketingShell>
  );
}

export default PartnerApplyPage;
