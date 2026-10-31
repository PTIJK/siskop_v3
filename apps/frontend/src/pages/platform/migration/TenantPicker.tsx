import { useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { filterTenants, type TenantOption } from "./tenants";

const MAX_VISIBLE = 50;

interface Props {
  tenants: readonly TenantOption[] | undefined;
  selectedId: string | null;
  onSelect: (tenant: TenantOption) => void;
  onClear: () => void;
  loading?: boolean;
  error?: string;
  inputId?: string;
}

/** Search a koperasi by name, subdomain or registration number and pick one; collapses into a card with "Ganti". */
export function TenantPicker({ tenants, selectedId, onSelect, onClear, loading, error, inputId }: Props) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => filterTenants(tenants ?? [], query).slice(0, MAX_VISIBLE), [tenants, query]);
  const selected = tenants?.find((t) => t.id === selectedId) ?? null;

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border bg-card p-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{selected.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {selected.slug} · {selected.registrationNo}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!selected.isActive && <Badge variant="warn">Nonaktif</Badge>}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onClear();
              setQuery("");
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
          >
            Ganti
          </Button>
        </div>
      </div>
    );
  }

  function choose(t: TenantOption | undefined) {
    if (!t) return;
    onSelect(t);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${listId}-${results[active]!.id}` : undefined}
          autoComplete="off"
          placeholder="Cari nama koperasi, subdomain, atau no. badan hukum"
          className="pl-9"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
        />
      </div>

      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {loading ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : error ? (
            <p className="p-3 text-sm text-destructive">{error}</p>
          ) : results.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Tidak ada koperasi yang cocok.</p>
          ) : (
            <ul id={listId} role="listbox" className="max-h-64 overflow-auto py-1">
              {results.map((t, i) => (
                <li
                  key={t.id}
                  id={`${listId}-${t.id}`}
                  role="option"
                  aria-selected={i === active}
                  // mousedown, not click: the input's blur would close the list before a click lands.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(t);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex cursor-pointer items-center justify-between gap-3 px-3 py-2", i === active && "bg-accent")}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t.slug} · {t.registrationNo}
                    </p>
                  </div>
                  {!t.isActive && <Badge variant="warn">Nonaktif</Badge>}
                </li>
              ))}
            </ul>
          )}
          {!loading && !error && tenants && (
            <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
              {results.length} dari {tenants.length} koperasi
            </p>
          )}
        </div>
      )}
    </div>
  );
}
