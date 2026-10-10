import { describe, expect, it } from "vitest";
import { exportFilename, exportPath } from "./exportPath";

describe("exportPath", () => {
  it("targets the export endpoint of a report with the report's own filters", () => {
    expect(exportPath("jurnal-umum", "csv", "from=2026-01-01&to=2026-10-10")).toBe(
      "/reports/export/jurnal-umum?format=csv&from=2026-01-01&to=2026-10-10"
    );
  });

  it("keeps a unit filter and works with no filters at all", () => {
    expect(exportPath("neraca", "xlsx", "asOfDate=2026-10-10&unitId=u1")).toBe("/reports/export/neraca?format=xlsx&asOfDate=2026-10-10&unitId=u1");
    expect(exportPath("neraca", "xlsx", "")).toBe("/reports/export/neraca?format=xlsx");
  });

  it("also builds the PDF URL for reports without a dedicated PDF endpoint", () => {
    expect(exportPath("neraca-saldo", "pdf", "from=2026-01-01&to=2026-10-10")).toBe(
      "/reports/export/neraca-saldo?format=pdf&from=2026-01-01&to=2026-10-10"
    );
  });

  it("drops a leading ampersand left by a unit-only query", () => {
    expect(exportPath("neraca", "csv", "&unitId=u1")).toBe("/reports/export/neraca?format=csv&unitId=u1");
  });
});

describe("exportFilename", () => {
  it("adds the extension for the chosen format", () => {
    expect(exportFilename("neraca-2026-10-10", "xlsx")).toBe("neraca-2026-10-10.xlsx");
    expect(exportFilename("neraca-2026-10-10", "csv")).toBe("neraca-2026-10-10.csv");
    expect(exportFilename("neraca-2026-10-10", "pdf")).toBe("neraca-2026-10-10.pdf");
  });
});
