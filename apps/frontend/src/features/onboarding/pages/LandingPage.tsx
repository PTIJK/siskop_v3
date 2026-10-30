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

// Mirrors the real "Beranda" screen: grouped sidebar, "Perlu perhatian hari ini", stat cards, trend, KOL health.
const previewNav = [
  ["Harian", ["Beranda", "Setor dan tarik", "Kasir toko"]],
  ["Anggota", ["Daftar anggota", "Simpanan", "Pinjaman"]],
  ["Keuangan", ["Beban umum", "Jurnal manual"]],
  ["Laporan", ["Laporan keuangan", "Kualitas portofolio"]]
] as const;

const previewTasks = [
  { count: 3, tone: "bad", word: "Mendesak", title: "Pinjaman macet", action: "Lihat anggota menunggak" },
  { count: 5, tone: "warn", word: "Perlu ditinjau", title: "Pinjaman mulai terlambat", action: "Lihat kualitas portofolio" },
  { count: 2, tone: "info", word: "Info", title: "Pendaftaran anggota menunggu", action: "Tinjau pendaftaran" }
] as const;

const previewStats = [
  ["Total simpanan", "Rp 96,8 jt", "Modal Rp 41,2 jt · dapat ditarik Rp 55,6 jt"],
  ["Pinjaman aktif", "Rp 71,4 jt", ""],
  ["Jumlah anggota", "248", "+6 dari bulan lalu"],
  ["Angsuran bulan ini", "Rp 8,9 jt", "Bulan lalu Rp 8,2 jt"]
] as const;

const previewKol = [
  ["1", 62, "Lancar"],
  ["2", 18, "Dalam perhatian"],
  ["3", 8, "Kurang lancar"],
  ["4", 6, "Diragukan"],
  ["5", 6, "Macet"]
] as const;

function ProductPreview() {
  return (
    <div className='product-preview' aria-hidden='true'>
      <div className='preview-bar'>
        <i />
        <i />
        <i />
        <span>Koperasi Barokah · Beranda</span>
      </div>
      <div className='preview-body'>
        <aside>
          {previewNav.map(([group, items]) => (
            <div key={group}>
              <small>{group}</small>
              {items.map((item) => (
                <span key={item} data-active={item === "Beranda"}>
                  {item}
                </span>
              ))}
            </div>
          ))}
        </aside>
        <div className='preview-main'>
          <div className='preview-head'>
            <strong>Beranda</strong>
            <small>Yang perlu diputuskan hari ini, lalu ringkasan keadaan koperasi.</small>
          </div>
          <div className='preview-split'>
            <section className='preview-attention'>
              <h4>Perlu perhatian hari ini</h4>
              <small>Diurutkan dari yang paling berisiko.</small>
              <ul>
                {previewTasks.map((task) => (
                  <li key={task.title}>
                    <b data-tone={task.tone}>{task.count}</b>
                    <span>
                      <strong>
                        {task.title} <em data-tone={task.tone}>{task.word}</em>
                      </strong>
                      <i>{task.action} →</i>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <div className='preview-right'>
              <div className='preview-stats'>
                {previewStats.map(([label, value, note]) => (
                  <div key={label}>
                    <small>{label}</small>
                    <strong>{value}</strong>
                    {note ? <em>{note}</em> : null}
                  </div>
                ))}
              </div>
              <div className='preview-trend'>
                <small>Pencairan dan angsuran · 12 bulan terakhir</small>
                <svg viewBox='0 0 240 64' preserveAspectRatio='none' role='presentation'>
                  <polyline className='line-a' points='0,48 22,40 44,44 66,30 88,34 110,22 132,28 154,16 176,24 198,12 220,18 240,8' />
                  <polyline className='line-b' points='0,56 22,52 44,54 66,46 88,48 110,40 132,44 154,36 176,40 198,32 220,36 240,28' />
                </svg>
              </div>
            </div>
          </div>
          <div className='preview-kol'>
            <small>Kesehatan pinjaman menurut KOL</small>
            <div>
              {previewKol.map(([level, count, label]) => (
                <span key={level} data-kol={level} style={{ flexGrow: count }} title={label}>
                  {level}
                </span>
              ))}
            </div>
          </div>
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
