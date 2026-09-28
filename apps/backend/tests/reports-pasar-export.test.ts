import { describe, it, expect } from "vitest";
import type { RekapHarianKolektor } from "@siskop/types";
import { rekapHarianKolektorCsv } from "../src/modules/reports/pasar-export.js";

describe("rekapHarianKolektorCsv", () => {
  it("renders one row per kolektor with Indonesian status labels", () => {
    const report: RekapHarianKolektor = {
      date: "2026-09-27",
      rows: [
        { collectorId: "c1", collectorName: "Budi", target: "100000", tertagih: "100000", disetor: "90000", selisih: "-10000", status: "VERIFIED" },
        { collectorId: "c2", collectorName: "Siti", target: null, tertagih: "0", disetor: null, selisih: null, status: "TIDAK_ADA_SETORAN" }
      ]
    };

    const csv = rekapHarianKolektorCsv(report);
    const lines = csv.trim().split("\r\n");

    expect(lines[0]).toBe("Kolektor,Target,Tertagih,Disetor,Selisih,Status");
    expect(lines[1]).toBe("Budi,100000,100000,90000,-10000,Terverifikasi");
    expect(lines[2]).toBe("Siti,,0,,,Tidak Ada Setoran");
  });
});
