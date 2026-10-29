import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, Check, Clock3, Loader2, RefreshCw } from "lucide-react";
import type { RegistrationStatus } from "@siskop/types";
import { MarketingShell, Steps } from "../components/MarketingShell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/stores/auth";
import { ApiRequestError } from "@/api/client";
import { errorMessage, onboardingApi, rupiah } from "../api";
import { formatTaxRate } from "../registration";

const POLL_MS = 5000;
const date = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "long" }).format(new Date(iso));

/**
 * Where a new koperasi lands after registering. A free one is already active; a
 * paid one shows its invoice and how to pay it, and flips to active once the
 * platform owner confirms the payment.
 */
export default function StatusPage() {
  const navigate = useNavigate();
  const clear = useAuth((s) => s.clear);
  const [status, setStatus] = useState<RegistrationStatus | null>(null);
  const [error, setError] = useState("");
  const [needsResume, setNeedsResume] = useState(false);
  const [checking, setChecking] = useState(false);
  const running = useRef(false);

  const update = useCallback(async () => {
    try {
      setStatus(await onboardingApi<RegistrationStatus>("/status"));
      setNeedsResume(false);
      setError("");
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) setNeedsResume(true);
      else setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void update();
  }, [update]);
  useEffect(() => {
    if (status?.status !== "PENDING_PAYMENT") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !running.current) void update();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [status?.status, update]);

  async function check() {
    if (running.current) return;
    running.current = true;
    setChecking(true);
    await update();
    running.current = false;
    setChecking(false);
  }

  function enter() {
    clear();
    if (status?.loginUrl) window.location.replace(`${status.loginUrl}?registered=1`);
    else navigate("/login?registered=1", { replace: true });
  }

  const active = status?.status === "ACTIVE";
  const invoice = status?.invoice ?? null;
  const tax = formatTaxRate(invoice?.taxRate ?? null);

  return (
    <MarketingShell>
      <main id='main-content' className='checkout-main content-width'>
        <Steps active={3} />
        <section className='checkout-panel' aria-live='polite'>
          <div className='status-icon'>{active ? <Check /> : <Clock3 />}</div>
          <h1>{needsResume ? "Lanjutkan langkah Anda." : active ? "Koperasi Anda sudah aktif." : !status ? "Memeriksa pendaftaran…" : "Satu langkah lagi."}</h1>
          <p className='checkout-description'>
            {needsResume
              ? "Masuk dengan akun yang Anda gunakan saat mendaftar untuk melihat tagihan Anda."
              : active
                ? "Masuk untuk membuka dashboard koperasi Anda."
                : "Selesaikan pembayaran faktur di bawah. Koperasi aktif setelah pembayaran dikonfirmasi."}
          </p>

          {status ? (
            <div className='checkout-total'>
              {invoice ? (
                <>
                  <span>Faktur {invoice.number}</span>
                  <strong>{rupiah(invoice.total)}</strong>
                  <dl className='quote-summary'>
                    <div>
                      <dt>Subtotal</dt>
                      <dd>{rupiah(invoice.subtotal)}</dd>
                    </div>
                    {tax ? (
                      <div>
                        <dt>PPN {tax}</dt>
                        <dd>{rupiah(invoice.taxAmount)}</dd>
                      </div>
                    ) : null}
                  </dl>
                </>
              ) : (
                <strong>Gratis</strong>
              )}
              <h2>{status.packageName}</h2>
              <p>
                {status.tenantName} · {status.slug}
              </p>
              {invoice && !active ? <small>Jatuh tempo {date(invoice.dueDate)}. Pendaftaran yang belum dibayar akan dihapus setelahnya.</small> : null}
            </div>
          ) : null}

          {status && !active && invoice ? (
            <div className='payment-instructions'>
              <h2>Cara pembayaran</h2>
              {status.paymentInstructions ? (
                <p>{status.paymentInstructions}</p>
              ) : (
                <p>Petunjuk pembayaran belum tersedia. Tim SISKOP akan menghubungi Anda melalui email pendaftaran.</p>
              )}
              <small>Cantumkan nomor faktur {invoice.number} saat transfer.</small>
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
            ) : active ? (
              <Button size='lg' onClick={enter}>
                Lanjut ke halaman masuk <ArrowUpRight />
              </Button>
            ) : status ? (
              <Button size='lg' variant='outline' disabled={checking} onClick={() => void check()}>
                {checking ? <Loader2 className='animate-spin' /> : <RefreshCw />} Periksa status pembayaran
              </Button>
            ) : error ? (
              <Button variant='outline' onClick={() => void update()}>
                Coba lagi
              </Button>
            ) : (
              <Loader2 className='mx-auto animate-spin' />
            )}
          </div>
        </section>
        <p className='checkout-bottom'>Dari anggota, untuk masa depan yang lebih baik.</p>
      </main>
    </MarketingShell>
  );
}
