import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Lock, Search, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Member } from "@siskop/types";
import { apiFetchPage } from "@/api/client";
import { maskNik } from "@/lib/format";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
import { buildQuickActions, matchesQuery } from "./nav";
import { useNavSections } from "./Sidebar";

type GroupName = "Aksi cepat" | "Halaman" | "Anggota";

interface PaletteItem {
  id: string;
  group: GroupName;
  label: string;
  hint?: string;
  icon: LucideIcon;
  locked?: boolean;
  to: string;
}

const GROUPS: readonly GroupName[] = ["Aksi cepat", "Halaman", "Anggota"];

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Ctrl/Cmd+K: quick actions, every page the user may open, and member search
 * by name, number or NIK. Arrows move, Enter opens, Esc closes.
 */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const sections = useNavSections();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = query.trim();
  const debounced = useDebounced(trimmed, 250);
  const canSearchMembers = can("members", "read");

  const members = useQuery({
    queryKey: ["palette", "members", debounced],
    queryFn: () => apiFetchPage<Member[]>(`/members?search=${encodeURIComponent(debounced)}&limit=5`),
    enabled: open && canSearchMembers && debounced.length >= 2
  });

  const items = useMemo<PaletteItem[]>(() => {
    const quick: PaletteItem[] = buildQuickActions({ can, isPlatformAdmin: false })
      .filter((a) => matchesQuery(a.label, query))
      .map((a) => ({ id: a.id, group: "Aksi cepat", label: a.label, icon: a.icon, to: a.href }));
    const pages: PaletteItem[] = sections
      .flatMap((s) => s.items.map((item) => ({ item, section: s.label })))
      .filter(({ item, section }) => matchesQuery(`${item.label} ${item.keywords ?? ""} ${section}`, query))
      .map(({ item, section }) => ({
        id: `page-${item.id}`,
        group: "Halaman",
        label: item.label,
        hint: section,
        icon: item.icon,
        locked: item.locked,
        to: item.to
      }));
    // Only show member hits that belong to the text currently in the box.
    const people: PaletteItem[] =
      debounced.length >= 2 && debounced === trimmed
        ? (members.data?.items ?? []).map((m) => ({
            id: `member-${m.id}`,
            group: "Anggota",
            label: m.fullName,
            hint: `${m.memberId} · NIK ${maskNik(m.nik)}`,
            icon: User,
            to: `/members/${m.id}`
          }))
        : [];
    return [...quick, ...pages, ...people];
  }, [can, sections, query, trimmed, debounced, members.data]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, listId]);

  function choose(item: PaletteItem | undefined) {
    if (!item) return;
    onOpenChange(false);
    navigate(item.to);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(items[active]);
    }
  }

  const grouped = GROUPS.map((name) => ({
    name,
    entries: items.map((item, index) => ({ item, index })).filter(({ item }) => item.group === name)
  }));
  const searching = canSearchMembers && debounced.length >= 2 && members.isFetching;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-scrim bg-foreground/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          className="fixed left-1/2 top-[12vh] z-modal w-[calc(100%-2rem)] max-w-[620px] -translate-x-1/2 overflow-hidden rounded-[20px] border bg-card shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          <DialogPrimitive.Title className="sr-only">Palet perintah</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Ketik untuk mencari aksi, halaman, atau anggota. Gunakan panah atas dan bawah, lalu Enter.
          </DialogPrimitive.Description>
          <div className="flex items-center gap-3 border-b px-4">
            <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={items.length > 0 ? `${listId}-${active}` : undefined}
              aria-autocomplete="list"
              aria-label="Cari aksi, halaman, atau anggota"
              placeholder="Cari aksi, halaman, atau anggota (nama, nomor, NIK)"
              className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
            />
            <kbd className="rounded-md border border-b-2 bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">Esc</kbd>
          </div>
          <div id={listId} role="listbox" aria-label="Hasil" className="max-h-[56vh] overflow-y-auto p-2">
            {grouped.map(({ name, entries }) =>
              entries.length === 0 ? null : (
                <div key={name} role="group" aria-label={name}>
                  <p className="px-3 pb-1 pt-2 text-xs font-bold text-muted-foreground">{name}</p>
                  {entries.map(({ item, index }) => {
                    const Icon = item.icon;
                    return (
                      <div
                        key={item.id}
                        id={`${listId}-${index}`}
                        role="option"
                        aria-selected={index === active}
                        onMouseMove={() => setActive(index)}
                        onClick={() => choose(item)}
                        className={cn(
                          "flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 text-[13.5px] font-semibold",
                          index === active && "bg-muted"
                        )}
                      >
                        <Icon className="h-[18px] w-[18px] shrink-0 opacity-80" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.hint && <span className="shrink-0 text-xs font-medium text-muted-foreground">{item.hint}</span>}
                        {item.locked && (
                          <>
                            <Lock className="h-[14px] w-[14px] shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span className="sr-only">(terkunci)</span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            )}
            {items.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground" role="status">
                {searching ? "Mencari anggota…" : "Tidak ada hasil. Coba nama, nomor anggota, atau NIK lain."}
              </p>
            )}
          </div>
          <div className="flex items-center gap-4 border-t px-4 py-2 text-xs text-muted-foreground">
            <span>↑↓ pilih</span>
            <span>Enter buka</span>
            <span>Esc tutup</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
