import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Member } from "@siskop/types";
import { ArrowDownCircle, ArrowUpCircle, CreditCard, ExternalLink } from "lucide-react";
import { apiFetch } from "@/api/client";
import { formatRupiah, formatTanggalPendek, maskNik } from "@/lib/format";
import { usePermissions } from "@/hooks/usePermissions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { KOLBadge } from "@/components/shared/KOLBadge";
import { GlossaryTerm, type GlossaryKey } from "@/components/shared/GlossaryTerm";

interface MemberDetail extends Member {
  savings: { id: string; savingConfig: { name: string; type: string }; balance: string; isActive: boolean }[];
  loans: {
    id: string;
    loanConfig: { name: string };
    remainingAmount: string;
    status: string;
    kolCategory: string;
  }[];
}

const TYPE_TERM: Record<string, GlossaryKey | undefined> = {
  POKOK: "Simpanan Pokok",
  WAJIB: "Simpanan Wajib",
  SUKARELA: "Simpanan Sukarela"
};

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

interface MemberDrawerProps {
  /** Member id (the database id), or null when closed. */
  memberId: string | null;
  onClose: () => void;
}

/** Member detail without leaving the list (design.md §8 Drawer): savings per type, loans with KOL, quick actions. */
export function MemberDrawer({ memberId, onClose }: MemberDrawerProps) {
  const { can } = usePermissions();
  const { data: member, isPending, isError, refetch } = useQuery({
    queryKey: ["members", memberId],
    queryFn: () => apiFetch<MemberDetail>(`/members/${memberId}`),
    enabled: memberId !== null
  });

  const totalSavings = member?.savings.reduce((sum, s) => sum + parseFloat(s.balance), 0) ?? 0;

  return (
    <Drawer open={memberId !== null} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent aria-describedby="member-drawer-desc">
        <DrawerHeader>
          <div className="flex items-center gap-3">
            <Avatar className="h-14 w-14">
              <AvatarFallback className="bg-accent text-lg font-extrabold text-accent-foreground">{member ? initials(member.fullName) : "…"}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <DrawerTitle className="truncate">{member?.fullName ?? "Memuat anggota"}</DrawerTitle>
              <DrawerDescription id="member-drawer-desc">
                {member ? `${member.memberId} · NIK ${maskNik(member.nik)}` : "Rincian anggota dibuka di panel ini."}
              </DrawerDescription>
            </div>
          </div>
        </DrawerHeader>

        <DrawerBody className="space-y-5">
          {isPending ? (
            <div className="space-y-3" role="status" aria-busy="true">
              <span className="sr-only">Memuat rincian anggota</span>
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-20 w-full rounded-[14px]" />
              <Skeleton className="h-20 w-full rounded-[14px]" />
            </div>
          ) : isError || !member ? (
            <div role="alert" className="space-y-2 rounded-[14px] border border-destructive/40 p-4 text-sm">
              <p className="font-bold text-destructive">Rincian anggota belum bisa dimuat.</p>
              <p className="text-muted-foreground">Periksa koneksi Anda, lalu coba lagi.</p>
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                Coba lagi
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant={member.isActive ? "ok" : "info"}>{member.isActive ? "Aktif" : "Nonaktif"}</Badge>
                <Badge variant="outline" className="font-mono">
                  Rek. {member.accountNumber}
                </Badge>
                <Badge variant="outline">Sejak {formatTanggalPendek(member.createdAt)}</Badge>
              </div>

              <section aria-labelledby="drawer-savings">
                <div className="mb-2 flex items-baseline justify-between">
                  <h3 id="drawer-savings" className="text-[15px] font-extrabold">
                    Simpanan
                  </h3>
                  <span className="text-sm font-bold tabular-nums">{formatRupiah(totalSavings)}</span>
                </div>
                {member.savings.length === 0 ? (
                  <p className="rounded-[14px] border p-3 text-sm text-muted-foreground">Belum ada rekening simpanan. Buka rekening dari tombol di bawah.</p>
                ) : (
                  <ul className="divide-y rounded-[14px] border">
                    {member.savings.map((s) => {
                      const term = TYPE_TERM[s.savingConfig.type];
                      return (
                        <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                          <Link to={`/savings/${s.id}`} className="min-w-0 truncate font-semibold hover:underline">
                            {term ? <GlossaryTerm term={term}>{s.savingConfig.name}</GlossaryTerm> : s.savingConfig.name}
                          </Link>
                          <span className="shrink-0 text-right font-bold tabular-nums">{formatRupiah(s.balance)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section aria-labelledby="drawer-loans">
                <h3 id="drawer-loans" className="mb-2 text-[15px] font-extrabold">
                  Pinjaman
                </h3>
                {member.loans.length === 0 ? (
                  <p className="rounded-[14px] border p-3 text-sm text-muted-foreground">Belum ada pinjaman.</p>
                ) : (
                  <ul className="divide-y rounded-[14px] border">
                    {member.loans.map((l) => (
                      <li key={l.id} className="space-y-1.5 px-3 py-2.5 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <Link to={`/loans/${l.id}`} className="min-w-0 truncate font-semibold hover:underline">
                            {l.loanConfig.name}
                          </Link>
                          <span className="shrink-0 text-right font-bold tabular-nums">{formatRupiah(l.remainingAmount)}</span>
                        </div>
                        <KOLBadge category={l.kolCategory} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </DrawerBody>

        {member && (
          <DrawerFooter>
            {can("savings", "create") && (
              <>
                <Button asChild variant="brand">
                  <Link to={`/savings/new?memberId=${member.id}&jenis=setor`}>
                    <ArrowDownCircle aria-hidden="true" /> Setor
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to={`/savings/new?memberId=${member.id}&jenis=tarik`}>
                    <ArrowUpCircle aria-hidden="true" /> Tarik
                  </Link>
                </Button>
              </>
            )}
            {can("loans", "create") && (
              <Button asChild variant="outline">
                <Link to={`/loans/new?memberId=${member.id}`}>
                  <CreditCard aria-hidden="true" /> Pinjaman baru
                </Link>
              </Button>
            )}
            <Button asChild variant="ghost" className="ml-auto">
              <Link to={`/members/${member.id}`}>
                Halaman lengkap <ExternalLink aria-hidden="true" />
              </Link>
            </Button>
          </DrawerFooter>
        )}
      </DrawerContent>
    </Drawer>
  );
}
