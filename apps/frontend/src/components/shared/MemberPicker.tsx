import { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface PickerMember {
  /** Member.id (database id). */
  id: string;
  /** Human-readable member number, e.g. A-001. */
  memberNumber: string;
  fullName: string;
  accountNumber?: string;
}

interface MemberPickerProps<T extends PickerMember> {
  selected: T | null;
  onSelect: (member: T) => void;
  onClear: () => void;
  /** Looks a member up by name, number or NIK. Called after the user pauses typing. */
  search: (query: string) => Promise<T[]>;
  /** Extra text on the right of a result row, e.g. total balance. */
  trailing?: (member: T) => React.ReactNode;
  disabled?: boolean;
  inputId?: string;
  className?: string;
}

const MAX_RESULTS = 4;

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/**
 * Search by name, number or NIK; at most four results, each with avatar, name,
 * number and a trailing value. Once chosen it collapses into a compact card
 * with "Ganti" (design.md §8 MemberPicker).
 */
export function MemberPicker<T extends PickerMember>({ selected, onSelect, onClear, search, trailing, disabled, inputId, className }: MemberPickerProps<T>) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<T[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [active, setActive] = useState(0);
  const listId = useId();
  const searchRef = useRef(search);
  searchRef.current = search;
  const debounced = useDebounced(query.trim(), 250);

  useEffect(() => {
    if (debounced.length < 2) {
      setResults([]);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    searchRef
      .current(debounced)
      .then((found) => {
        if (cancelled) return;
        setResults(found.slice(0, MAX_RESULTS));
        setActive(0);
        setStatus("done");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  if (selected) {
    return (
      <div className={cn("flex items-center gap-3 rounded-[14px] border bg-card p-3", className)}>
        <Avatar className="h-11 w-11">
          <AvatarFallback className="bg-accent font-extrabold text-accent-foreground">{initials(selected.fullName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold">{selected.fullName}</p>
          <p className="font-mono text-xs text-muted-foreground">{selected.memberNumber}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={disabled} className="max-sm:h-11">
          Ganti
        </Button>
      </div>
    );
  }

  const pick = (member: T | undefined) => {
    if (!member) return;
    setQuery("");
    setResults([]);
    setStatus("idle");
    onSelect(member);
  };

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3.5 top-[13px] h-[18px] w-[18px] text-muted-foreground" aria-hidden="true" />
      <Input
        id={inputId}
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={results.length > 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder="Cari nama, nomor anggota, atau NIK"
        className="pl-10"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && results.length > 0) {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape") {
            setQuery("");
          }
        }}
      />
      <div aria-live="polite" className="mt-2">
        {status === "loading" && (
          <div className="space-y-2" role="status" aria-busy="true">
            <span className="sr-only">Mencari anggota</span>
            <Skeleton className="h-14 w-full rounded-[12px]" />
            <Skeleton className="h-14 w-full rounded-[12px]" />
          </div>
        )}
        {status === "error" && <p role="alert" className="text-[12.5px] font-semibold text-destructive">Pencarian belum berhasil. Coba ketik lagi.</p>}
        {status === "done" && results.length === 0 && (
          <p className="text-[12.5px] text-muted-foreground">Tidak ada anggota yang cocok. Coba nama, nomor anggota, atau NIK lain.</p>
        )}
      </div>
      {results.length > 0 && (
        <ul id={listId} role="listbox" aria-label="Hasil pencarian anggota" className="mt-1 divide-y overflow-hidden rounded-[14px] border bg-card">
          {results.map((m, index) => (
            <li
              key={m.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseMove={() => setActive(index)}
              onClick={() => pick(m)}
              className={cn("flex min-h-[56px] cursor-pointer items-center gap-3 px-3 py-2", index === active && "bg-muted")}
            >
              <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-accent text-xs font-extrabold text-accent-foreground">{initials(m.fullName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{m.fullName}</p>
                <p className="font-mono text-xs text-muted-foreground">{m.memberNumber}</p>
              </div>
              {trailing && <div className="shrink-0 text-right text-sm font-bold tabular-nums">{trailing(m)}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
