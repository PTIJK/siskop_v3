import { useId, useState } from "react";
import { cn } from "@/lib/utils";

export const GLOSSARY = {
  KOL: "Kolektibilitas: tingkat kelancaran pembayaran angsuran pinjaman, dari KOL 1 (Lancar) sampai KOL 5 (Macet).",
  NPL: "Non-Performing Loan: persentase pinjaman bermasalah (KOL 3 sampai 5) dari seluruh pinjaman yang beredar.",
  SHU: "Sisa Hasil Usaha: keuntungan koperasi setelah dikurangi biaya, dibagikan kepada anggota.",
  CALK: "Catatan atas Laporan Keuangan: penjelasan rinci tentang angka-angka di laporan keuangan.",
  BMPP: "Batas Maksimum Pemberian Pinjaman: plafon tertinggi yang boleh diberikan kepada satu peminjam.",
  "Modal Sendiri": "Modal yang berasal dari anggota dan cadangan koperasi, bukan dari pinjaman pihak luar.",
  "Simpanan Pokok": "Setoran satu kali saat menjadi anggota, jumlahnya sama untuk semua anggota.",
  "Simpanan Wajib": "Setoran rutin anggota dengan jumlah dan jadwal tetap yang ditentukan koperasi.",
  "Simpanan Sukarela": "Simpanan yang boleh disetor dan ditarik anggota kapan saja sesuai aturan koperasi."
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;

interface GlossaryTermProps {
  term: GlossaryKey;
  /** Visible text; defaults to the term itself. */
  children?: React.ReactNode;
  className?: string;
}

/** Dotted-underline term with a one-sentence plain-language definition on hover or keyboard focus (Esc dismisses). */
export function GlossaryTerm({ term, children, className }: GlossaryTermProps) {
  const tipId = useId();
  const [dismissed, setDismissed] = useState(false);
  return (
    <span className={cn("group relative inline-block", className)}>
      <span
        tabIndex={0}
        aria-describedby={tipId}
        onKeyDown={(event) => {
          if (event.key === "Escape") setDismissed(true);
        }}
        onMouseEnter={() => setDismissed(false)}
        onFocus={() => setDismissed(false)}
        className="cursor-help rounded-[2px] border-b-[1.5px] border-dotted border-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children ?? term}
      </span>
      <span
        role="tooltip"
        id={tipId}
        className={cn(
          "pointer-events-none absolute left-0 top-[calc(100%+6px)] z-popover hidden w-[250px] rounded-[10px] bg-foreground px-3 py-2.5 text-left text-[12.5px] font-medium leading-snug text-background shadow-lg",
          !dismissed && "group-focus-within:block group-hover:block"
        )}
      >
        {GLOSSARY[term]}
      </span>
    </span>
  );
}
