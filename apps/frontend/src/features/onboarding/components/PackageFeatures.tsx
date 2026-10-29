import type { PublicPricingCatalog } from "@siskop/types";
import { Check } from "lucide-react";

type Catalog = Pick<PublicPricingCatalog, "features" | "settings">;
const count = (n: number | null, noun: string) => (n === null ? `${noun} tanpa batas` : `${n.toLocaleString("id-ID")} ${noun}`);

/** The short feature list on a package card: limits first, then the standout priced features. */
export function PackageFeatures({ pkg, catalog, max = 4 }: { pkg: PublicPricingCatalog["packages"][number]; catalog: Catalog; max?: number }) {
  const limits = pkg.isCustom ? catalog.settings.customBaseLimits : pkg.limits;
  const standout = pkg.isCustom
    ? []
    : catalog.features.filter((f) => pkg.features.includes(f.key) && Number(f.customPrice) > 0 && f.parentKey !== null).map((f) => f.name);
  const items = [
    pkg.isCustom ? "Pilih fitur sesuai kebutuhan" : "Simpanan & pinjaman",
    count(limits.members, "anggota"),
    count(limits.users, "pengguna"),
    `${count(limits.savingTypes, "jenis simpanan")} · ${count(limits.loanTypes, "jenis pinjaman")}`,
    ...standout.slice(0, max),
    ...(standout.length > max ? [`+${standout.length - max} fitur lainnya`] : [])
  ];
  return (
    <ul className='package-features'>
      {items.map((item) => (
        <li key={item}>
          <Check aria-hidden='true' />
          {item}
        </li>
      ))}
    </ul>
  );
}
