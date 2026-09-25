import { Fragment, useEffect, useRef, useState } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Search, ChevronLeft, ChevronRight, ChevronDown, Inbox, AlertTriangle } from "lucide-react";
import { cn } from "../../lib/utils";

export interface ColumnDef<T> {
  header: string;
  accessorKey?: keyof T;
  cell?: (props: { row: { original: T } }) => React.ReactNode;
  className?: string;
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
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  emptyMessage?: string;
  headerActions?: React.ReactNode;
  /** Stable row identity — keeps expansion state on the right row across pages. */
  getRowKey?: (row: T) => string;
  /** When set, row click toggles a panel rendered below the row (instead of `onRowClick`). */
  renderExpanded?: (row: T) => React.ReactNode;
}

export function DataTable<T>({
  columns,
  data,
  isLoading,
  isError,
  errorMessage = "Gagal memuat data",
  onRetry,
  pagination,
  search,
  onRowClick,
  rowClassName,
  emptyMessage = "Tidak ada data",
  headerActions,
  getRowKey,
  renderExpanded
}: DataTableProps<T>) {
  const [searchInput, setSearchInput] = useState(search?.value ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  const totalPages = pagination ? Math.ceil(pagination.total / pagination.limit) : 1;

  return (
    <div className="space-y-4">
      {(search || headerActions) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {search && (
            <div className="relative max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={search.placeholder ?? "Cari..."}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9"
              />
            </div>
          )}
          {headerActions && <div className="flex items-center gap-2">{headerActions}</div>}
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col, i) => (
                <TableHead key={i} className={col.className}>
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {columns.map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2 text-destructive">
                    <AlertTriangle className="h-8 w-8" />
                    <p className="text-sm">{errorMessage}</p>
                    {onRetry && (
                      <Button variant="outline" size="sm" onClick={onRetry}>
                        Coba lagi
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Inbox className="h-8 w-8" />
                    <p className="text-sm">{emptyMessage}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              data.map((row, i) => {
                const key = getRowKey?.(row) ?? String(i);
                const isExpanded = expanded.has(key);
                return (
                  <Fragment key={key}>
                    <TableRow
                      onClick={() => (renderExpanded ? toggleExpanded(key) : onRowClick?.(row))}
                      aria-expanded={renderExpanded ? isExpanded : undefined}
                      className={cn(
                        (renderExpanded || onRowClick) && "cursor-pointer hover:bg-muted/50",
                        rowClassName?.(row)
                      )}
                    >
                      {columns.map((col, j) => (
                        <TableCell key={j} className={col.className}>
                          {renderExpanded && j === 0 ? (
                            <div className="flex items-start gap-2">
                              {isExpanded ? (
                                <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
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
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={columns.length} className="py-2 pl-10">
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

      {pagination && totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <p>
            {Math.min((pagination.page - 1) * pagination.limit + 1, pagination.total)}–
            {Math.min(pagination.page * pagination.limit, pagination.total)} dari {pagination.total}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => {
              const page = i + 1;
              return (
                <Button
                  key={page}
                  variant={pagination.page === page ? "default" : "outline"}
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => pagination.onPageChange(page)}
                >
                  {page}
                </Button>
              );
            })}
            {totalPages > 5 && pagination.page > 5 && <span className="px-1">...</span>}
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={pagination.page >= totalPages}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function renderCell<T>(col: ColumnDef<T>, row: T): React.ReactNode {
  if (col.cell) return col.cell({ row: { original: row } });
  return col.accessorKey ? String(row[col.accessorKey] ?? "") : null;
}
