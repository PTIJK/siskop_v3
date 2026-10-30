import { Fragment, useEffect, useRef, useState } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { EmptyState } from "./EmptyState";
import { Search, ChevronLeft, ChevronRight, ChevronDown, AlertTriangle, Download } from "lucide-react";
import { cn } from "../../lib/utils";

export interface ColumnDef<T> {
  header: string;
  accessorKey?: keyof T;
  cell?: (props: { row: { original: T } }) => React.ReactNode;
  /** Applies to the header and the cells. "text-right" marks a money/number column: header, cells and tabular figures follow. */
  className?: string;
}

export interface FilterChip {
  value: string;
  label: string;
  /** Number of rows behind the chip, when the page knows it. */
  count?: number;
}

export interface ExportOption {
  label: string;
  onSelect: () => void;
}

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
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
  /** Row click (and Enter on a focused row) opens the page's detail drawer or page. */
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  emptyMessage?: string;
  /** One sentence teaching the next step, shown under the empty title. */
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  headerActions?: React.ReactNode;
  /** Stable row identity — keeps expansion state on the right row across pages. */
  getRowKey?: (row: T) => string;
  /** When set, row click toggles a panel rendered below the row (instead of `onRowClick`). */
  renderExpanded?: (row: T) => React.ReactNode;
  /** Filter chips above the table (single choice, e.g. Semua / Aktif / Nonaktif). */
  chips?: { options: FilterChip[]; value: string; onChange: (value: string) => void; label?: string };
  /** Export menu in the footer (PDF, CSV, ...). Each page supplies the real export. */
  exportOptions?: ExportOption[];
  /** Accessible name for the table. */
  label?: string;
}

type Density = "comfortable" | "compact";
const DENSITY_KEY = "siskop.table.density";

function readDensity(): Density {
  try {
    return localStorage.getItem(DENSITY_KEY) === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}

export function DataTable<T>({
  columns,
  data,
  isLoading,
  isError,
  errorMessage = "Data belum bisa dimuat. Periksa koneksi, lalu coba lagi.",
  onRetry,
  pagination,
  search,
  onRowClick,
  rowClassName,
  emptyMessage = "Belum ada data",
  emptyDescription,
  emptyAction,
  headerActions,
  getRowKey,
  renderExpanded,
  chips,
  exportOptions,
  label
}: DataTableProps<T>) {
  const [searchInput, setSearchInput] = useState(search?.value ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [density, setDensity] = useState<Density>(readDensity);

  // A new page/filter replaces the rows — stale expansion keys would never match again.
  // Returning `prev` when already empty matters: callers pass `data?.items ?? []`, a fresh
  // array every render while loading, and a fresh Set each time would re-render forever.
  useEffect(() => {
    setExpanded((prev) => (prev.size === 0 ? prev : new Set()));
  }, [data]);

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  useEffect(() => {
    if (!search) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      search.onChange(searchInput);
    }, 300);
    return () => clearTimeout(debounceRef.current);
    // `search` is a fresh object every render (parent passes an inline literal) —
    // depending on it would re-fire the debounce timer every render and defeat it.
  }, [searchInput]);

  useEffect(() => {
    if (search) setSearchInput(search.value);
    // Same reasoning as above — `search` itself is a new object every render.
  }, [search?.value]);

  const chooseDensity = (next: Density) => {
    setDensity(next);
    try {
      localStorage.setItem(DENSITY_KEY, next);
    } catch {
      // Not remembered when storage is blocked.
    }
  };

  const totalPages = pagination ? Math.ceil(pagination.total / pagination.limit) : 1;
  const compact = density === "compact";
  const interactive = Boolean(renderExpanded || onRowClick);
  const cellPad = compact ? "px-3 py-2 text-[13px]" : "px-4 py-3.5";
  const shown = data.length;

  const activateRow = (row: T, key: string) => {
    if (renderExpanded) toggleExpanded(key);
    else onRowClick?.(row);
  };

  return (
    <div className="space-y-3">
      {(search || headerActions || chips) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            {search && (
              <div className="relative w-full sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  type="search"
                  aria-label={search.placeholder ?? "Cari"}
                  placeholder={search.placeholder ?? "Cari..."}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="pl-10"
                />
              </div>
            )}
            {chips && (
              <div role="group" aria-label={chips.label ?? "Filter"} className="flex flex-wrap gap-2">
                {chips.options.map((chip) => (
                  <button
                    key={chip.value}
                    type="button"
                    aria-pressed={chips.value === chip.value}
                    onClick={() => chips.onChange(chip.value)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-input bg-card px-3 text-[13px] font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-transparent aria-pressed:bg-primary aria-pressed:text-primary-foreground max-[900px]:h-10"
                  >
                    {chip.label}
                    {chip.count !== undefined && <b className="font-extrabold tabular-nums opacity-75">{chip.count}</b>}
                  </button>
                ))}
              </div>
            )}
          </div>
          {headerActions && <div className="flex items-center gap-2">{headerActions}</div>}
        </div>
      )}

      {/* overflow: clip, never hidden: hidden makes this a scroll container and the sticky header stops sticking. */}
      <div className="overflow-clip rounded-[16px] border bg-card">
        <Table
          aria-label={label}
          aria-busy={isLoading || undefined}
          containerClassName="overflow-visible"
          className="max-[900px]:block"
        >
          <TableHeader className="max-[900px]:hidden">
            <TableRow className="hover:bg-muted">
              {columns.map((col, i) => (
                <TableHead
                  key={i}
                  scope="col"
                  className={cn("sticky top-[60px] z-10 h-11 bg-muted px-4 text-[12.5px] font-bold", compact && "px-3", col.className)}
                >
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className="max-[900px]:block">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i} className="max-[900px]:block max-[900px]:p-3">
                  {columns.map((_, j) => (
                    <TableCell key={j} className={cn(cellPad, "max-[900px]:block max-[900px]:px-0 max-[900px]:py-1.5")}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : isError ? (
              <TableRow className="max-[900px]:block">
                <TableCell colSpan={columns.length} className="py-12 text-center max-[900px]:block">
                  <div role="alert" className="flex flex-col items-center gap-2 text-destructive">
                    <AlertTriangle className="h-8 w-8" aria-hidden="true" />
                    <p className="max-w-sm text-sm font-semibold">{errorMessage}</p>
                    {onRetry && (
                      <Button variant="outline" size="sm" onClick={onRetry}>
                        Coba lagi
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow className="hover:bg-transparent max-[900px]:block">
                <TableCell colSpan={columns.length} className="p-0 max-[900px]:block">
                  <EmptyState title={emptyMessage} description={emptyDescription} action={emptyAction} />
                </TableCell>
              </TableRow>
            ) : (
              data.map((row, i) => {
                const key = getRowKey?.(row) ?? String(i);
                const isExpanded = expanded.has(key);
                return (
                  <Fragment key={key}>
                    <TableRow
                      onClick={() => activateRow(row, key)}
                      onKeyDown={
                        interactive
                          ? (event) => {
                              if (event.target !== event.currentTarget) return;
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                activateRow(row, key);
                              }
                            }
                          : undefined
                      }
                      tabIndex={interactive ? 0 : undefined}
                      aria-expanded={renderExpanded ? isExpanded : undefined}
                      className={cn(
                        interactive && "cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        "max-[900px]:grid max-[900px]:grid-cols-2 max-[900px]:gap-x-3 max-[900px]:gap-y-2 max-[900px]:p-3",
                        rowClassName?.(row)
                      )}
                    >
                      {columns.map((col, j) => (
                        <TableCell
                          key={j}
                          data-label={col.header}
                          className={cn(
                            cellPad,
                            col.className?.includes("text-right") && "tabular-nums",
                            // Card mode: label above the value, two columns per row.
                            "max-[900px]:block max-[900px]:min-w-0 max-[900px]:p-0 max-[900px]:text-left",
                            "max-[900px]:before:mb-0.5 max-[900px]:before:block max-[900px]:before:text-xs max-[900px]:before:font-semibold max-[900px]:before:text-muted-foreground max-[900px]:before:content-[attr(data-label)]",
                            col.className
                          )}
                        >
                          {renderExpanded && j === 0 ? (
                            <div className="flex items-start gap-2">
                              {isExpanded ? (
                                <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                              ) : (
                                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                              )}
                              <div className="min-w-0 flex-1">{renderCell(col, row)}</div>
                            </div>
                          ) : (
                            renderCell(col, row)
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                    {renderExpanded && isExpanded && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30 max-[900px]:block">
                        <TableCell colSpan={columns.length} className="py-2 pl-10 max-[900px]:block max-[900px]:pl-3">
                          {renderExpanded(row)}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center gap-3">
          {pagination ? (
            <p aria-live="polite">
              Menampilkan{" "}
              <span className="tabular-nums">
                {pagination.total === 0 ? 0 : Math.min((pagination.page - 1) * pagination.limit + 1, pagination.total)}–
                {Math.min(pagination.page * pagination.limit, pagination.total)}
              </span>{" "}
              dari <span className="tabular-nums">{pagination.total}</span>
            </p>
          ) : (
            !isLoading && shown > 0 && (
              <p>
                Menampilkan <span className="tabular-nums">{shown}</span> baris
              </p>
            )
          )}
          <div role="group" aria-label="Kepadatan tabel" className="inline-flex rounded-[11px] bg-muted p-[3px]">
            {(["comfortable", "compact"] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={density === d}
                onClick={() => chooseDensity(d)}
                className="rounded-[8px] px-3 py-1 text-[12.5px] font-bold text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm"
              >
                {d === "comfortable" ? "Nyaman" : "Padat"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {exportOptions && exportOptions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download aria-hidden="true" /> Ekspor
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {exportOptions.map((option) => (
                  <DropdownMenuItem key={option.label} onSelect={option.onSelect}>
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {pagination && totalPages > 1 && (
            <nav aria-label="Halaman" className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 max-[900px]:h-11 max-[900px]:w-11"
                aria-label="Halaman sebelumnya"
                disabled={pagination.page <= 1}
                onClick={() => pagination.onPageChange(pagination.page - 1)}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => {
                // A window of five pages that follows the current one, so later pages stay reachable.
                const first = Math.max(1, Math.min(pagination.page - 2, totalPages - 4));
                const page = first + i;
                return (
                  <Button
                    key={page}
                    variant={pagination.page === page ? "default" : "outline"}
                    size="icon"
                    className="h-8 w-8 tabular-nums max-[900px]:h-11 max-[900px]:w-11"
                    aria-label={`Halaman ${page}`}
                    aria-current={pagination.page === page ? "page" : undefined}
                    onClick={() => pagination.onPageChange(page)}
                  >
                    {page}
                  </Button>
                );
              })}
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 max-[900px]:h-11 max-[900px]:w-11"
                aria-label="Halaman berikutnya"
                disabled={pagination.page >= totalPages}
                onClick={() => pagination.onPageChange(pagination.page + 1)}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}

function renderCell<T>(col: ColumnDef<T>, row: T): React.ReactNode {
  if (col.cell) return col.cell({ row: { original: row } });
  return col.accessorKey ? String(row[col.accessorKey] ?? "") : null;
}
