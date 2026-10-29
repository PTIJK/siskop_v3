import { PackageFeatures } from "../components/PackageFeatures";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUpRight, RefreshCw } from "lucide-react";
import type { BillingCycle } from "@siskop/types";
import { MarketingShell } from "../components/MarketingShell";
import { HeroScene } from "../components/HeroScene";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CycleToggle } from "../components/PackagePicker";
import { errorMessage, rupiah, unitNames, usePublicPricing } from "../api";
import { formatTaxRate, priceOf, yearlySaving } from "../registration";

export default function LandingPage() {
  const container = useRef<HTMLElement>(null);
  const catalog = usePublicPricing();
  const [cycle, setCycle] = useState<BillingCycle>("MONTHLY");
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
      },
      { threshold: 0.08 }
    );
    container.current?.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);
  return (
    <MarketingShell landing>
      <main id='main-content' ref={container}>
        <section className='hero content-width' aria-labelledby='hero-title'>
          <div className='hero-copy'>
            <h1 id='hero-title'>
              Koperasi maju.
              <br />
              <span>Tumbuh bersama.</span>
            </h1>
            <p>Satu ruang untuk anggota, simpanan, dan masa depan koperasi Anda.</p>
            <div className='hero-actions'>
              <Button asChild size='lg'>
                <a href='#paket'>
                  Temukan paket Anda <ArrowUpRight />
                </a>
              </Button>
              <a className='text-action' href='#platform'>
                Kenali SISKOP <ArrowDown size={18} />
              </a>
            </div>
          </div>
          <HeroScene />
          <div className='hero-principles'>
            <span>Anggota terhubung</span>
            <span>Operasional tertata</span>
            <span>Keuangan transparan</span>
            <a href='#platform' aria-label='Lihat platform'>
              <ArrowDown size={19} />
            </a>
          </div>
        </section>
        <section id='platform' className='platform-section'>
          <div className='content-width reveal'>
            <h2>
              Ruang untuk <span>setiap</span> koperasi.
            </h2>
            <div className='cooperative-types'>
              {Object.entries(unitNames).map(([type, name]) => (
                <a key={type} href='#paket'>
                  {name}
                </a>
              ))}
            </div>
          </div>
        </section>
        <section id='paket' className='catalog-section content-width'>
          <div className='section-heading reveal'>
            <h2>Pilih ruang tumbuh Anda.</h2>
            <p>
              Paket sesuai kebutuhan koperasi.
              <br />
              {catalog.data ? (formatTaxRate(catalog.data.settings.taxRate) ? `Harga belum termasuk PPN ${formatTaxRate(catalog.data.settings.taxRate)}.` : "Harga belum termasuk PPN.") : "Harga transparan, tanpa biaya tersembunyi."}
            </p>
          </div>
          {catalog.isPending ? (
            <div className='catalog-loading' role='status' aria-label='Memuat paket'>
              <Skeleton className='h-56 w-full' />
            </div>
          ) : catalog.isError ? (
            <div className='catalog-empty' role='alert'>
              <h3>Paket belum dapat dimuat.</h3>
              <p>{errorMessage(catalog.error)}</p>
              <Button variant='outline' onClick={() => void catalog.refetch()}>
                <RefreshCw /> Coba lagi
              </Button>
            </div>
          ) : catalog.data.packages.length === 0 ? (
            <div className='catalog-empty'>
              <h3>Paket sedang disiapkan.</h3>
              <p>Silakan kunjungi kembali untuk melihat paket yang tersedia.</p>
            </div>
          ) : (
            <>
              <CycleToggle
                cycles={catalog.data.settings.enabledCycles}
                value={catalog.data.settings.enabledCycles.includes(cycle) ? cycle : (catalog.data.settings.enabledCycles[0] ?? "MONTHLY")}
                onChange={setCycle}
                saving={Math.max(0, ...catalog.data.packages.map((p) => yearlySaving(p) ?? 0))}
              />
              <div className='package-list'>
                {catalog.data.packages.map((pkg) => {
                  const shown = catalog.data.settings.enabledCycles.includes(cycle) ? cycle : (catalog.data.settings.enabledCycles[0] ?? "MONTHLY");
                  const price = priceOf(pkg, shown);
                  return (
                    <article className='package-band' key={pkg.code}>
                      <div className='package-name'>
                        <h3>{pkg.name}</h3>
                        <p>{pkg.isCustom ? "Susun sendiri fitur yang Anda butuhkan." : "Ruang untuk operasional koperasi Anda."}</p>
                        <div className='package-price'>
                          {pkg.isCustom ? "Sesuai pilihan" : price === null ? "Gratis" : rupiah(price)}
                          {!pkg.isCustom && price !== null ? <span> / {shown === "MONTHLY" ? "bulan" : "tahun"}</span> : null}
                        </div>
                      </div>
                      <PackageFeatures pkg={pkg} catalog={catalog.data} />
                      <div className='package-action'>
                        <Button asChild size='lg'>
                          <Link to={`/register?package=${encodeURIComponent(pkg.code)}&cycle=${shown.toLowerCase()}`}>
                            Pilih paket <ArrowUpRight />
                          </Link>
                        </Button>
                        <span>{price === null && !pkg.isCustom ? "Aktif segera setelah mendaftar." : "Aktif setelah pembayaran dikonfirmasi."}</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </section>
        <section id='cara-bergabung' className='how-section content-width reveal'>
          <h2>Dari rencana, jadi langkah nyata.</h2>
          <ol>
            {[
              ["Pilih paket", "Pilih paket yang sesuai, atau susun sendiri paket Custom."],
              ["Daftarkan koperasi", "Isi data koperasi dan buat akun pengelola Anda."],
              [
                "Bayar, lalu mulai",
                "Paket berbayar: transfer sesuai faktur. Dashboard aktif setelah pembayaran dikonfirmasi. Paket Free langsung aktif."
              ]
            ].map(([title, description], index) => (
              <li key={title}>
                <span className='step-number'>0{index + 1}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </MarketingShell>
  );
}
