import { PackageFeatures } from "../components/PackageFeatures";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  BookOpenCheck,
  Check,
  FileBarChart2,
  HandCoins,
  Landmark,
  PiggyBank,
  RefreshCw,
  ShieldCheck,
  Store,
  Users
} from "lucide-react";
import type { BillingCycle } from "@siskop/types";
import { MarketingShell } from "../components/MarketingShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CycleToggle } from "../components/PackagePicker";
import { errorMessage, rupiah, unitNames, usePublicPricing } from "../api";
import { formatTaxRate, priceOf, yearlySaving } from "../registration";
import "../landing.css";

const featureChips = ["Anggota", "Simpanan", "Pinjaman", "Akuntansi", "Laporan", "Unit usaha", "Whitelabel"];

const replaces = [
  ["Hemat biaya.", "Anggota, simpanan, pinjaman, dan pembukuan dalam satu langganan."],
  ["Hemat waktu.", "Setiap transaksi langsung tercatat di jurnal. Tanpa input ganda."],
  ["Laporan siap pakai.", "Neraca, laba rugi, arus kas, dan laporan regulasi dari data yang sama."]
];

const bento = [
  { icon: Users, title: "Anggota terhubung", text: "Data anggota, dokumen, dan riwayat transaksi dalam satu profil.", wide: true },
  { icon: PiggyBank, title: "Simpanan tertata", text: "Pokok, wajib, dan sukarela dengan rekening koran otomatis." },
  { icon: HandCoins, title: "Pinjaman terkendali", text: "Jadwal angsuran, kolektibilitas, dan tunggakan terpantau." },
  { icon: BookOpenCheck, title: "Pembukuan otomatis", text: "Jurnal tercipta dari setiap transaksi, siap ditutup buku.", wide: true },
  { icon: Store, title: "Unit usaha", text: "Toko, kasir, dan unit lain dalam satu laporan konsolidasi." },
  { icon: FileBarChart2, title: "Laporan regulasi", text: "Format laporan yang dibutuhkan pengurus dan pengawas.", wide: true }
];

const mockRows = [
  ["Budi Santoso", "Setoran simpanan wajib", "Rp 250.000"],
  ["Siti Rahayu", "Angsuran pinjaman", "Rp 1.150.000"],
  ["Agus Wibowo", "Setoran simpanan sukarela", "Rp 500.000"]
];

function ProductPreview() {
  return (
    <div className='product-preview' aria-hidden='true'>
      <div className='preview-bar'>
        <i />
        <i />
        <i />
        <span>Koperasi Barokah · Dashboard</span>
      </div>
      <div className='preview-body'>
        <aside>
          {["Dashboard", "Anggota", "Simpanan", "Pinjaman", "Laporan"].map((item, index) => (
            <span key={item} data-active={index === 0}>
              {item}
            </span>
          ))}
        </aside>
        <div className='preview-main'>
          <div className='preview-stats'>
            {[
              ["Kas & Bank", "Rp 148.200.000"],
              ["Simpanan", "Rp 96.750.000"],
              ["Pinjaman beredar", "Rp 71.400.000"]
            ].map(([label, value]) => (
              <div key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className='preview-chart'>
            {[38, 52, 44, 63, 58, 74, 69, 88].map((height, index) => (
              <i key={index} style={{ height: `${height}%` }} />
            ))}
          </div>
          <ul className='preview-rows'>
            {mockRows.map(([name, note, amount]) => (
              <li key={name}>
                <span>
                  <b>{name}</b>
                  <small>{note}</small>
                </span>
                <em>{amount}</em>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

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
      <main id='main-content' ref={container} className='landing'>
        <section className='lp-hero content-width' aria-labelledby='hero-title'>
          <p className='lp-eyebrow'>
            <span>Baru</span> Pembukuan, simpanan, dan pinjaman dalam satu ruang
          </p>
          <h1 id='hero-title'>
            Satu ruang kerja untuk <span>koperasi yang tumbuh bersama.</span>
          </h1>
          <p className='lp-sub'>
            SISKOP menghubungkan anggota, simpanan, pinjaman, dan laporan keuangan koperasi Anda, supaya pengurus fokus melayani anggota.
          </p>
          <div className='lp-actions'>
            <Button asChild size='lg'>
              <a href='#paket'>
                Mulai sekarang <ArrowUpRight />
              </a>
            </Button>
            <a className='lp-ghost' href='#fitur'>
              Lihat fitur
            </a>
          </div>
          <p className='lp-micro'>Tersedia paket gratis. Tanpa kartu kredit.</p>
          <div className='lp-preview-wrap'>
            <ProductPreview />
          </div>
          <ul className='lp-chips' aria-label='Modul SISKOP'>
            {featureChips.map((chip) => (
              <li key={chip}>{chip}</li>
            ))}
          </ul>
        </section>

        <section id='platform' className='lp-replace content-width reveal'>
          <h2>
            Satu platform untuk <span>semua pekerjaan koperasi.</span>
          </h2>
          <ul>
            {replaces.map(([title, text]) => (
              <li key={title}>
                <Check aria-hidden='true' />
                <p>
                  <strong>{title}</strong> {text}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section id='fitur' className='lp-bento content-width' aria-labelledby='fitur-title'>
          <div className='lp-heading reveal'>
            <h2 id='fitur-title'>Semua yang koperasi butuhkan, tertata rapi.</h2>
            <p>Dari pencatatan harian sampai laporan akhir tahun.</p>
          </div>
          <div className='bento-grid'>
            {bento.map(({ icon: Icon, title, text, wide }) => (
              <article key={title} className={wide ? "bento-card bento-wide reveal" : "bento-card reveal"}>
                <span className='bento-icon'>
                  <Icon aria-hidden='true' />
                </span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className='lp-types content-width reveal' aria-label='Jenis koperasi'>
          <p>
            <Landmark aria-hidden='true' /> Dibuat untuk berbagai jenis koperasi
          </p>
          <div className='cooperative-types'>
            {Object.entries(unitNames).map(([type, name]) => (
              <a key={type} href='#paket'>
                {name}
              </a>
            ))}
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

        <section className='lp-cta content-width reveal' aria-labelledby='cta-title'>
          <ShieldCheck aria-hidden='true' />
          <h2 id='cta-title'>Siap membawa koperasi Anda naik kelas?</h2>
          <p>Mulai dari paket gratis, tingkatkan kapan pun koperasi Anda siap.</p>
          <Button asChild size='lg'>
            <a href='#paket'>
              Temukan paket Anda <ArrowUpRight />
            </a>
          </Button>
        </section>
      </main>
    </MarketingShell>
  );
}
