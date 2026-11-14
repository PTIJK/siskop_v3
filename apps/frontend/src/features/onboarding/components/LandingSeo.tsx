import { DEFINITION, FAQS, LAST_UPDATED } from "@/seo/content";
import type { PublicPricingCatalog } from "@siskop/types";
import { rupiah, usePublicPricing } from "../api";

type Limits = PublicPricingCatalog["packages"][number]["limits"];
const limit = (n: number | null) => (n === null ? "Tanpa batas" : n.toLocaleString("id-ID"));

/** The answer to "what is SISKOP", placed before any marketing copy so it can be quoted as written. */
export function Definition() {
  return (
    <section id='apa-itu-siskop' className='lp-definition content-width' aria-labelledby='definition-title'>
      <h2 id='definition-title'>Apa itu SISKOP?</h2>
      <p>{DEFINITION}</p>
    </section>
  );
}

/** Plain table of the published catalog: the same numbers as /pricing.md and the Offer JSON-LD. */
export function PricingTable() {
  const catalog = usePublicPricing();
  if (!catalog.data || catalog.data.packages.length === 0) return null;
  const { packages, settings } = catalog.data;
  const rows = packages.map((pkg) => {
    const limits: Limits = pkg.isCustom ? settings.customBaseLimits : pkg.limits;
    return { pkg, limits };
  });
  return (
    <div className='lp-compare reveal'>
      <h3>Perbandingan paket SISKOP</h3>
      <div className='lp-compare-scroll'>
        <table>
          <caption>Harga per paket dan batas yang termasuk di dalamnya. Harga belum termasuk PPN.</caption>
          <thead>
            <tr>
              <th scope='col'>Paket</th>
              <th scope='col'>Harga per bulan</th>
              <th scope='col'>Harga per tahun</th>
              <th scope='col'>Anggota</th>
              <th scope='col'>Pengguna</th>
              <th scope='col'>Jenis simpanan</th>
              <th scope='col'>Jenis pinjaman</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ pkg, limits }) => (
              <tr key={pkg.code}>
                <th scope='row'>{pkg.name}</th>
                <td>{pkg.isCustom ? "Sesuai pilihan" : pkg.priceMonthly === null ? "Gratis" : rupiah(pkg.priceMonthly)}</td>
                <td>{pkg.isCustom ? "Sesuai pilihan" : pkg.priceYearly === null ? (pkg.priceMonthly === null ? "Gratis" : "-") : rupiah(pkg.priceYearly)}</td>
                <td>{limit(limits.members)}</td>
                <td>{limit(limits.users)}</td>
                <td>{limit(limits.savingTypes)}</td>
                <td>{limit(limits.loanTypes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Visible FAQ: the FAQPage JSON-LD is built from the same FAQS list. */
export function Faq() {
  return (
    <section id='faq' className='lp-faq content-width reveal' aria-labelledby='faq-title'>
      <h2 id='faq-title'>Pertanyaan yang sering diajukan</h2>
      <div>
        {FAQS.map(({ question, answer }) => (
          <div key={question} className='lp-faq-item'>
            <h3>{question}</h3>
            <p>{answer}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const updated = new Date(`${LAST_UPDATED}T00:00:00Z`).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function LastUpdated() {
  return (
    <p className='lp-updated content-width'>
      Terakhir diperbarui: <time dateTime={LAST_UPDATED}>{updated}</time>
    </p>
  );
}
