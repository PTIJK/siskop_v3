import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search, ChevronLeft, ChevronRight, Inbox, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// The card-list replacement for desktop's DataTable (a raw <table>), per
// docs/07-System-Architecture-SISKOP-Mobile-Version.md §8: every list screen
// in Fase 1 scope (Members/Savings/Loans/Overdue) uses this instead of a
// table, since the UI audit found raw tables are the single biggest overflow
// risk at phone width. Same functional shape as DataTable (search, pagination,
// loading/error/empty states) so nothing is dropped — only the row rendering
// mechanism changes from table cells to a card.
interface CardListProps<T> {
  items: T[];
  keyExtractor: (item: T) => string;
  renderCard: (item: T) => ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  onItemClick?: (item: T) => void;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    onPageChange: (page: number) => void;
  };
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  emptyMessage?: string;
}

export function CardList<T>({
  items,
  keyExtractor,
  renderCard,
  isLoading,
  isError,
  errorMessage = "Gagal memuat data",
  onRetry,
  onItemClick,
  pagination,
  search,
  emptyMessage = "Tidak ada data"
}: CardListProps<T>) {
  const [searchInput, setSearchInput] = useState(search?.value ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!search) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search.onChange(searchInput), 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);

  useEffect(() => {
    if (search) setSearchInput(search.value);
  }, [search?.value]);

  const totalPages = pagination ? Math.ceil(pagination.total / pagination.limit) : 1;

  return (
    <div className="space-y-3">
      {search && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            placeholder={search.placeholder ?? "Cari..."}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg border bg-muted" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border py-10 text-center text-destructive">
          <AlertTriangle className="h-6 w-6" />
          <p className="text-sm">{errorMessage}</p>
          {onRetry && (
            <button onClick={onRetry} className="rounded-md border px-3 py-1.5 text-xs font-medium">
              Coba lagi
            </button>
          )}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border py-10 text-center text-muted-foreground">
          <Inbox className="h-6 w-6" />
          <p className="text-sm">{emptyMessage}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={keyExtractor(item)}
              onClick={() => onItemClick?.(item)}
              className={cn(
                "rounded-lg border bg-card p-3",
                onItemClick && "cursor-pointer active:bg-accent"
              )}
            >
              {renderCard(item)}
            </div>
          ))}
        </div>
      )}

      {pagination && totalPages > 1 && (
        <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
          <p>
            {Math.min((pagination.page - 1) * pagination.limit + 1, pagination.total)}–
            {Math.min(pagination.page * pagination.limit, pagination.total)} dari {pagination.total}
          </p>
          <div className="flex items-center gap-2">
            <button
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              className="rounded-md border p-1.5 disabled:opacity-40"
              aria-label="Halaman sebelumnya"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span>
              {pagination.page} / {totalPages}
            </span>
            <button
              disabled={pagination.page >= totalPages}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              className="rounded-md border p-1.5 disabled:opacity-40"
              aria-label="Halaman berikutnya"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
