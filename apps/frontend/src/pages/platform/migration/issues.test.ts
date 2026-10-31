import { describe, expect, it } from "vitest";
import type { MigrationIssue, MigrationPreview } from "@siskop/types";
import { groupIssues, issueCounts } from "./issues";
import { buildIssueReportCsv, buildIssueSummaryText } from "./report";

const i = (severity: "error" | "warning", sheet: string, row: number | null, message = "m", column: string | null = null): MigrationIssue => ({
  severity,
  sheet,
  row,
  column,
  message
});

const preview = (issues: MigrationIssue[]): MigrationPreview => ({
  mode: "SISTEM",
  target: null,
  fileHash: "a".repeat(64),
  tenantName: "Koperasi Uji",
  slug: "koperasi-uji",
  cutoffDate: "2025-12-31",
  counts: [],
  totals: null,
  openingEntry: [],
  issues,
  canExecute: !issues.some((x) => x.severity === "error")
});

describe("issues", () => {
  it("counts by severity", () => {
    expect(issueCounts([i("error", "a", 1), i("warning", "a", 2), i("error", "b", 3)])).toEqual({ errors: 2, warnings: 1 });
  });

  it("groups by sheet with errors first, then row order", () => {
    const g = groupIssues([i("warning", "b", 2), i("error", "b", 9), i("error", "a", 5), i("error", "a", 1)]);
    expect(g.map((x) => x.sheet)).toEqual(["a", "b"]);
    expect(g[0]!.issues.map((x) => x.row)).toEqual([1, 5]);
    expect(g[1]!.issues.map((x) => x.severity)).toEqual(["error", "warning"]);
  });
});

describe("buildIssueReportCsv", () => {
  const now = new Date("2026-10-31T03:00:00Z");

  it("starts with a BOM, uses CRLF, and carries the file header", () => {
    const csv = buildIssueReportCsv(preview([i("error", "3_Anggota", 18, "NIK harus 16 digit", "nik")]), "kopkar.xlsx", now);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("\r\n");
    expect(csv).toContain("Koperasi Uji");
    expect(csv).toContain("kopkar.xlsx");
    expect(csv).toContain("2026-10-31");
    expect(csv).toContain("aaaaaaaaaaaa");
  });

  it("writes Tingkat, Sheet, Baris, Kolom, Masalah and blank Perbaikan/Status columns", () => {
    const csv = buildIssueReportCsv(preview([i("error", "3_Anggota", 18, "NIK harus 16 digit", "nik")]), "k.xlsx", now);
    expect(csv).toContain("Tingkat,Sheet,Baris,Kolom,Masalah,Perbaikan,Status");
    expect(csv).toContain("Kesalahan,3_Anggota,18,nik,NIK harus 16 digit,,");
  });

  it("escapes commas, quotes and newlines", () => {
    const csv = buildIssueReportCsv(preview([i("error", "s", 1, 'a, "b"\nc')]), "k.xlsx", now);
    expect(csv).toContain('"a, ""b""\nc"');
  });

  it("lists errors before warnings and leaves an empty row cell for sheet-level issues", () => {
    const csv = buildIssueReportCsv(preview([i("warning", "b", null, "w"), i("error", "b", 2, "e")]), "k.xlsx", now);
    expect(csv.indexOf("Kesalahan,b,2")).toBeLessThan(csv.indexOf("Peringatan,b,,"));
  });

  it("has only the header when there are no issues", () => {
    const csv = buildIssueReportCsv(preview([]), "k.xlsx", now);
    expect(csv).not.toContain("Kesalahan,");
    expect(csv).not.toContain("Peringatan,");
  });
});

describe("buildIssueSummaryText", () => {
  it("counts and shows at most 5 examples", () => {
    const many = Array.from({ length: 8 }, (_, n) => i("error", "3_Anggota", n + 4, `err ${n}`, "nik"));
    const text = buildIssueSummaryText(preview(many), "k.xlsx");
    expect(text).toContain("8 kesalahan");
    expect(text).toContain("err 0");
    expect(text).toContain("err 4");
    expect(text).not.toContain("err 5");
    expect(text).toContain("3_Anggota");
  });

  it("says the file is clean when there are no errors", () => {
    expect(buildIssueSummaryText(preview([]), "k.xlsx")).toMatch(/tidak ada kesalahan/i);
  });
});
