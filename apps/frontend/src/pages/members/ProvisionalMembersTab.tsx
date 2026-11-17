import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ProvisionalMember } from "@siskop/types";
import { apiFetch } from "@/api/client";
import { DataTable } from "@/components/shared/DataTable";
import { Badge } from "@/components/ui/badge";

const LIMIT = 25;

function MemberSourceDetails({ member }: { member: ProvisionalMember }) {
  return (
    <dl className="grid gap-3 py-2 sm:grid-cols-2 lg:grid-cols-3">
      {[
        ["NIK", member.nik],
        ["Alamat", member.address],
        ["Tempat lahir", member.birthPlace],
        ["Tanggal lahir", member.birthDate],
        ["Pekerjaan", member.occupation],
        ["No. anggota lama", member.legacyNo],
        ["Baris di 3_Anggota", String(member.sourceRow)]
      ].map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
          <dd className="min-h-5 text-sm [overflow-wrap:anywhere]">{value ?? <span className="sr-only">Belum tersedia</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProvisionalMembersTab({ tenantId }: { tenantId: string }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const members = useQuery({
    queryKey: ["members", tenantId, "provisional-rat"],
    queryFn: () => apiFetch<ProvisionalMember[]>("/members/provisional-rat"),
    gcTime: 0,
    retry: false
  });
  const term = search.trim().toLocaleLowerCase("id-ID");
  const filtered = (members.data ?? []).filter((row) =>
    !term || [row.fullName, row.temporaryId, row.legacyNo].some((text) => text?.toLocaleLowerCase("id-ID").includes(term)));

  return (
    <div className="space-y-3">
      <p className="max-w-prose text-sm text-muted-foreground">
        Daftar dari Excel RAT 2025. ID TMP adalah referensi sementara. Buka baris untuk melihat rincian sumber.
      </p>
      <DataTable<ProvisionalMember>
        label="Anggota belum terverifikasi"
        columns={[
          { header: "ID sementara", accessorKey: "temporaryId", className: "font-mono text-xs" },
          { header: "Nama lengkap", accessorKey: "fullName", className: "[overflow-wrap:anywhere]" },
          { header: "NIK", cell: () => <span className="sr-only">Belum tersedia</span> },
          { header: "Status", cell: () => <Badge variant="warn">Belum terverifikasi</Badge> }
        ]}
        data={filtered.slice((page - 1) * LIMIT, page * LIMIT)}
        isLoading={members.isPending}
        isError={members.isError}
        onRetry={() => void members.refetch()}
        emptyMessage={term ? "Tidak ada nama atau ID yang cocok" : "Belum ada data anggota dari arsip RAT"}
        getRowKey={(row) => String(row.sourceRow)}
        pagination={{ page, limit: LIMIT, total: filtered.length, onPageChange: setPage }}
        search={{ value: search, onChange: (value) => { setSearch(value); setPage(1); }, placeholder: "Cari nama atau ID sementara" }}
        renderExpanded={(row) => <MemberSourceDetails member={row} />}
      />
    </div>
  );
}
