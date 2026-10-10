import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Prev/next for list reports. Renders nothing when everything fits on one page. */
export function ReportPager({
  page,
  limit,
  total,
  onPage,
  disabled
}: {
  page: number;
  limit: number;
  total: number;
  onPage: (page: number) => void;
  disabled?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>
        Halaman {page} dari {pages} · {total} baris
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          Sebelumnya
        </Button>
        <Button variant="outline" size="sm" disabled={disabled || page >= pages} onClick={() => onPage(page + 1)}>
          Berikutnya
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
