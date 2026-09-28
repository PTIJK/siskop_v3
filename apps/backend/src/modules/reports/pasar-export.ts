import type { RekapHarianKolektor } from "@siskop/types";
import { toCsv } from "../../lib/csv.js";

const STATUS_LABEL: Record<string, string> = {
  TIDAK_ADA_SETORAN: "Tidak Ada Setoran",
  OPEN: "Berjalan",
  SUBMITTED: "Menunggu Verifikasi",
  VERIFIED: "Terverifikasi"
};

export function rekapHarianKolektorCsv(report: RekapHarianKolektor): string {
  return toCsv([
    ["Kolektor", "Target", "Tertagih", "Disetor", "Selisih", "Status"],
    ...report.rows.map((r) => [
      r.collectorName,
      r.target ?? "",
      r.tertagih,
      r.disetor ?? "",
      r.selisih ?? "",
      STATUS_LABEL[r.status] ?? r.status
    ])
  ]);
}
