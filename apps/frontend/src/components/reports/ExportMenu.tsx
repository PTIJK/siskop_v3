import { useState } from "react";
import { Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { downloadFile, downloadPdf } from "@/lib/pdf";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";
import { exportFilename, exportPath, type ExportFormat } from "./exportPath";

interface ExportMenuProps {
  /** Report name in the export endpoint, e.g. "jurnal-umum". */
  report: string;
  /** The filters the report was run with, as a query string (no leading "?"). */
  query: string;
  /** Download file name without extension. */
  stem: string;
  /** The server PDF endpoint, for reports that have one. */
  pdfPath?: string;
}

/** Ekspor: PDF (where the report has one), CSV and XLSX. Hidden without reports:export. */
export function ExportMenu({ report, query, stem, pdfPath }: ExportMenuProps) {
  const { can } = usePermissions();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  if (!can("reports", "export")) return null;

  const run = async (format: ExportFormat) => {
    setBusy(true);
    try {
      const filename = exportFilename(stem, format);
      if (format === "pdf") await downloadPdf(pdfPath!, filename);
      else await downloadFile(exportPath(report, format, query), filename);
    } catch (err) {
      toast({ title: "Gagal mengunduh", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          <Download className="mr-2 h-4 w-4" />
          {busy ? "Menyiapkan..." : "Ekspor"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {pdfPath && (
          <DropdownMenuItem onSelect={() => void run("pdf")}>
            <Printer className="mr-2 h-4 w-4" />
            PDF
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => void run("xlsx")}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void run("csv")}>
          <FileText className="mr-2 h-4 w-4" />
          CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
