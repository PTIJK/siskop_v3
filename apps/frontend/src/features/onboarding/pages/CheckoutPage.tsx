import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Check, Clock3, Loader2, LockKeyhole, RefreshCw } from "lucide-react";
import type { OnboardingCompletion, OnboardingStatus } from "@siskop/types";
import { MarketingShell, Steps } from "../components/MarketingShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/stores/auth";
import { ApiRequestError } from "@/api/client";
import { errorMessage, onboardingApi, rupiah } from "../api";

export default function CheckoutPage() {
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const clear = useAuth((s) => s.clear);
  const [order, setOrder] = useState<OnboardingStatus | null>(null);
  const [error, setError] = useState("");
  const [needsResume, setNeedsResume] = useState(false);
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const autoStarted = useRef(false);
  const update = useCallback(async () => {
    try {
      const result = await onboardingApi<OnboardingStatus>("/status");
      setOrder(result);
      setNeedsResume(false);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) setNeedsResume(true);
      else setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void update();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !running.current) void update();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [update]);
  const start = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError("");
    try {
      const result = await onboardingApi<OnboardingStatus>("/checkout", {});
      setOrder(result);
      if (result.status !== "PAID" && result.checkout?.status === "ACTIVE" && result.checkout.url)
        window.location.assign(result.checkout.url);
    } catch (err) {
      setError(errorMessage(err));
      await update();
    } finally {
      running.current = false;
      setPending(false);
    }
  }, [update]);
  useEffect(() => {
    if (search.get("start") === "1" && order && !autoStarted.current) {
      autoStarted.current = true;
      setSearch({}, { replace: true });
      void start();
    }
  }, [search, setSearch, order, start]);
  async function check() {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError("");
    try {
      setOrder(await onboardingApi<OnboardingStatus>("/reconcile", {}));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      running.current = false;
      setPending(false);
    }
  }
  const enter = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError("");
    try {
      await onboardingApi<OnboardingCompletion>("/complete", {});
      clear();
      navigate("/login?registered=1", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      running.current = false;
      setPending(false);
    }
  }, [clear, navigate]);
  const redirected = useRef(false);
  useEffect(() => {
    if (order?.status === "PAID" && !redirected.current && !pending) {
      redirected.current = true;
      void enter();
    }
  }, [order?.status, pending, enter]);
  const paid = order?.status === "PAID";
  const creating = order?.checkout?.status === "CREATING";
  const expired = order?.checkout && ["EXPIRED", "CANCELED"].includes(order.checkout.status);
  return (
    <MarketingShell>
      <main id='main-content' className='checkout-main content-width'>
        <Steps active={3} />
        <section className='checkout-panel' aria-live='polite'>
          <div className='status-icon'>{paid ? <Check /> : <Clock3 />}</div>
          <h1>
            {needsResume
              ? "Lanjutkan langkah Anda."
              : paid
                ? "Pembayaran berhasil."
                : !order
                  ? "Memeriksa pendaftaran…"
                  : expired
                    ? "Tautan telah berakhir."
                    : creating
                      ? "Menyiapkan pembayaran."
                      : "Satu langkah lagi."}
          </h1>
          <p className='checkout-description'>
            {needsResume
              ? "Masuk dengan data pendaftaran Anda untuk melanjutkan pembayaran."
              : paid
                ? "Koperasi Anda sudah aktif. Mengarahkan ke halaman masuk…"
                : expired
                  ? "Buat tautan pembayaran baru untuk melanjutkan pendaftaran yang sama."
                  : creating
                    ? "Kami sedang memastikan tautan pembayaran Anda. Periksa status kembali sebelum memulai pembayaran baru."
                    : "Selesaikan pembayaran untuk membuka dashboard koperasi Anda."}
          </p>
          {search.get("canceled") && !paid ? (
            <p className='form-note'>Pembayaran belum selesai. Anda dapat melanjutkannya di sini.</p>
          ) : null}
          {order ? (
            <div className='checkout-total'>
              <span>Total pembayaran</span>
              <strong>{rupiah(order.amount)}</strong>
              <h2>{order.packageName}</h2>
              <p>
                {order.tenantName} · {order.slug}
              </p>
              <small>Satu bulan akses. Tidak diperpanjang otomatis.</small>
            </div>
          ) : null}
          {error ? (
            <p className='form-error' role='alert'>
              {error}
            </p>
          ) : null}
          <div className='checkout-actions'>
            {needsResume ? (
              <Button asChild size='lg'>
                <Link to='/checkout/resume'>
                  Lanjutkan pendaftaran <ArrowUpRight />
                </Link>
              </Button>
            ) : paid ? (
              <Button size='lg' disabled={pending} onClick={() => void enter()}>
                {pending ? <Loader2 className='animate-spin' /> : null} Lanjut ke halaman masuk <ArrowUpRight />
              </Button>
            ) : order ? (
              <>
                {!creating ? (
                  <Button size='lg' disabled={pending} onClick={() => void start()}>
                    {pending ? <Loader2 className='animate-spin' /> : null}
                    {expired ? "Buat tautan pembayaran baru" : "Lanjut bayar melalui Xendit"} <ArrowUpRight />
                  </Button>
                ) : null}
                <Button size='lg' variant='outline' disabled={pending} onClick={() => void check()}>
                  <RefreshCw /> Periksa status pembayaran
                </Button>
              </>
            ) : error ? (
              <Button variant='outline' onClick={() => void update()}>
                Coba lagi
              </Button>
            ) : (
              <Loader2 className='mx-auto animate-spin' />
            )}
          </div>
          <p className='payment-note'>
            <LockKeyhole size={15} /> Pembayaran diproses melalui Xendit.
          </p>
        </section>
        <p className='checkout-bottom'>Dari anggota, untuk masa depan yang lebih baik.</p>
      </main>
    </MarketingShell>
  );
}
export function ResumePage() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      await onboardingApi<OnboardingStatus>("/resume", {
        slug: data.get("slug"),
        email: data.get("email"),
        password: data.get("password")
      });
      navigate("/checkout", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <MarketingShell>
      <main id='main-content' className='resume-main content-width'>
        <section className='checkout-panel'>
          <h1>Lanjutkan pendaftaran lama.</h1>
          <p className='checkout-description'>Gunakan akun pengelola yang Anda buat saat mendaftar.</p>
          <form onSubmit={submit} className='resume-form'>
            <div className='field'>
              <Label htmlFor='resume-slug'>Alamat workspace</Label>
              <Input
                required
                id='resume-slug'
                name='slug'
                placeholder='sejahtera-bersama'
                autoCapitalize='none'
              />
            </div>
            <div className='field'>
              <Label htmlFor='resume-email'>Email pengelola</Label>
              <Input required type='email' id='resume-email' name='email' autoComplete='username' />
            </div>
            <div className='field'>
              <Label htmlFor='resume-password'>Kata sandi</Label>
              <Input
                required
                type='password'
                id='resume-password'
                name='password'
                autoComplete='current-password'
              />
            </div>
            {error ? (
              <p className='form-error' role='alert'>
                {error}
              </p>
            ) : null}
            <Button size='lg' disabled={pending}>
              {pending ? "Memeriksa…" : "Lanjutkan"}
              <ArrowUpRight />
            </Button>
          </form>
        </section>
      </main>
    </MarketingShell>
  );
}
