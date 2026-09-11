import type { PublicPackage } from "@siskop/types";
import { Check } from "lucide-react";

export function PackageFeatures({ pkg }: { pkg: PublicPackage }) {
  return (
    <ul className='package-features'>
      {[
        `${pkg.maxMembers.toLocaleString("id-ID")} anggota`,
        `${pkg.maxUsers.toLocaleString("id-ID")} pengguna`,
        "Simpanan & pinjaman",
        ...(pkg.modules.includes("accounting") ? ["Akuntansi & laporan"] : []),
        ...(pkg.whitelabelEnabled ? ["Identitas koperasi Anda"] : []),
        ...(pkg.maxSavingConfigs !== null ? [`${pkg.maxSavingConfigs} jenis simpanan`] : [])
      ].map((item) => (
        <li key={item}>
          <Check aria-hidden='true' />
          {item}
        </li>
      ))}
    </ul>
  );
}
