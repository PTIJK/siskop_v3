import type { Response } from "express";
import type { SavingStatement } from "@siskop/types";
import { generateSavingStatementPdf } from "../reports/pdf.js";
import { savingStatementCsv, savingStatementFilename } from "./statement-export.js";

// Shared by the staff (/savings) and member-portal (/member/savings) routes.

export function sendStatementCsv(res: Response, statement: SavingStatement): void {
  res.set({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${savingStatementFilename(statement, "csv")}"`
  });
  // BOM so Excel opens the UTF-8 file with the right encoding.
  res.send(`\uFEFF${savingStatementCsv(statement)}`);
}

export async function sendStatementPdf(res: Response, tenantId: string, statement: SavingStatement): Promise<void> {
  const pdf = await generateSavingStatementPdf(tenantId, statement);
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${savingStatementFilename(statement, "pdf")}"`
  });
  res.send(pdf);
}
