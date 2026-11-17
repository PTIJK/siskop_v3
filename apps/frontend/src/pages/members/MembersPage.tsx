import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KOPKAR_RAT_TENANT_ID, type Member, type ProvisionalMember } from "@siskop/types";
import { apiFetch, apiFetchPage } from "@/api/client";
import { formatTanggalPendek } from "@/lib/format";
import { useAuth } from "@/stores/auth";
import { usePermissions } from "@/hooks/usePermissions";
import { useEntitlements } from "@/hooks/useEntitlements";
import { QuotaBadge } from "@/components/shared/QuotaBadge";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserPlus } from "lucide-react";
import { GenerateQrModal } from "./GenerateQrModal";
import { MemberDrawer } from "./MemberDrawer";
import { RegistrationRequestsTab } from "./RegistrationRequestsTab";
import { ProvisionalMemberDialog } from "./ProvisionalMemberDialog";
import { canReviewKopkarRat } from "@/pages/reports/KopkarRatArchivePage";
import { ActivateTmpMembers } from "./ActivateTmpMembers";
import { appendPage } from "@/components/shared/directory-pagination";

const LIMIT = 20;

type DirectoryRow = { live: Member; pending?: never } | { pending: ProvisionalMember; live?: never };

function MembersListTab({ tenantId, provisionalOnly = false }: { tenantId?: string; provisionalOnly?: boolean }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { can } = usePermissions();
  const user = useAuth((state) => state.user);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [openDraft, setOpenDraft] = useState<ProvisionalMember | null>(null);
  const [saved, setSaved] = useState(false);
  const trimmed = search.trim();
  const provisionalKey = ["members", tenantId, "provisional-rat"];
  const registered = useQuery({
    queryKey: ["members", tenantId, { page, search: trimmed, provisionalOnly }],
    queryFn: () => apiFetchPage<Member[]>(`/members?${new URLSearchParams({ page: String(page), limit: String(LIMIT), ...(trimmed && { search: trimmed }), ...(provisionalOnly && { identityUnverified: "true" }) })}`)
  });
  const provisional = useQuery({
    queryKey: provisionalKey,
    enabled: Boolean(tenantId),
    queryFn: () => apiFetch<ProvisionalMember[]>("/members/provisional-rat"),
    gcTime: 0,
    retry: false
  });

  const term = trimmed.toLocaleLowerCase("id-ID");
  const pending = (provisional.data ?? []).filter((row) =>
    !term || [row.fullName, row.temporaryId, row.legacyNo, row.nik].some((text) => text?.toLocaleLowerCase("id-ID").includes(term)));
  const live = registered.data?.items ?? [];
  const registeredTotal = registered.data?.meta.total ?? 0;
  const total = registeredTotal + pending.length;
  const loading = registered.isPending || (!!tenantId && provisional.isPending);
  const failed = registered.isError || (!!tenantId && provisional.isError);
  const error = registered.error ?? provisional.error;

  useEffect(() => {
    if (!loading && !failed && page > Math.max(1, Math.ceil(total / LIMIT))) setPage(Math.max(1, Math.ceil(total / LIMIT)));
  }, [loading, failed, page, total]);

  const data: DirectoryRow[] = loading || failed ? [] : [
    ...live.map((member) => ({ live: member })),
    ...appendPage(pending, registeredTotal, live.length, page, LIMIT).map((member) => ({ pending: member }))
  ];
  const canEdit = can("members", "update");
  const columns: ColumnDef<DirectoryRow>[] = [
    { header: "ID Anggota", className: "font-mono text-xs", cell: ({ row: { original } }) => original.live?.memberId ?? original.pending?.temporaryId },
    { header: "Nama Lengkap", cell: ({ row: { original } }) => original.live?.fullName ?? original.pending?.fullName },
    { header: "NIK", className: "font-mono text-xs", cell: ({ row: { original } }) =>
      original.live?.nik ?? original.pending?.nik ?? <span className="sr-only">Belum tersedia</span> },
    { header: "No. Rekening", className: "font-mono text-xs", cell: ({ row: { original } }) => original.live?.accountNumber },
    { header: "Pekerjaan", cell: ({ row: { original } }) => original.live?.occupation ?? original.pending?.occupation },
    { header: "Status", cell: ({ row: { original } }) => original.pending
      ? <Badge variant="warn">Belum terverifikasi</Badge>
      : <div className="flex flex-wrap gap-1">
        <Badge variant={original.live.isActive ? "ok" : "info"}>{original.live.isActive ? "Aktif" : "Nonaktif"}</Badge>
        {original.live.identityUnverified && <Badge variant="warn">Belum terverifikasi</Badge>}
      </div> },
    { header: "Tgl. Daftar", cell: ({ row: { original } }) => original.live ? formatTanggalPendek(original.live.createdAt) : null },
    { header: "Aksi", cell: ({ row: { original } }) => original.pending ? (
      <Button size="sm" variant="outline" aria-label={(canEdit ? "Edit " : "Detail ") + original.pending.temporaryId}
        onClick={(e) => { e.stopPropagation(); setSaved(false); setOpenDraft(original.pending); }}>
        {canEdit ? "Edit" : "Detail"}
      </Button>
    ) : (
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); navigate("/members/" + original.live.id); }}>Detail</Button>
        {canEdit && <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); navigate("/members/" + original.live.id + "/edit"); }}>Edit</Button>}
      </div>
    ) }
  ];

  return <>
    {saved && <p role="status" className="pb-3 text-sm font-medium">Koreksi anggota tersimpan.</p>}
    <DataTable<DirectoryRow>
      label={provisionalOnly ? "Anggota belum terverifikasi" : "Daftar anggota"} columns={columns} data={data}
      isLoading={loading} isError={failed} errorMessage={error instanceof Error ? error.message : undefined}
      onRetry={() => { void registered.refetch(); if (tenantId) void provisional.refetch(); }}
      search={{ value: search, onChange: (value) => { setSearch(value); setPage(1); }, placeholder: "Cari nama, NIK, ID..." }}
      headerActions={!provisionalOnly && can("members", "create") && canReviewKopkarRat(user)
        ? <ActivateTmpMembers count={provisional.data?.length ?? 0} /> : undefined}
      pagination={{ page, limit: LIMIT, total, onPageChange: setPage }}
      onRowClick={(row) => { if (row.pending) { setSaved(false); setOpenDraft(row.pending); } else setOpenId(row.live.id); }}
      getRowKey={(row) => row.live ? row.live.id : row.pending.temporaryId}
      emptyDescription={!trimmed && !provisionalOnly ? "Tambah anggota pertama, atau bagikan QR pendaftaran agar calon anggota mendaftar sendiri." : undefined}
      emptyMessage={trimmed ? "Tidak ada anggota yang cocok" : provisionalOnly ? "Belum ada anggota untuk diperiksa" : "Belum ada anggota terdaftar"}
    />
    <MemberDrawer memberId={openId} onClose={() => setOpenId(null)} />
    {openDraft && <ProvisionalMemberDialog
      member={openDraft} editable={canEdit} onClose={() => { setOpenDraft(null); void provisional.refetch(); }}
      onSaved={(updated) => {
        client.setQueryData<ProvisionalMember[]>(provisionalKey, (old) =>
          old?.map((row) => row.sourceRow === updated.sourceRow ? updated : row));
        setOpenDraft(null);
        setSaved(true);
        void client.invalidateQueries({ queryKey: provisionalKey });
      }}
    />}
  </>;
}

export function MembersPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { quota } = useEntitlements();
  const canReviewRegistrations = can("members", "create");
  const tenantId = useAuth((state) => state.user?.tenantId);
  const [params] = useSearchParams();
  const canViewProvisional = tenantId === KOPKAR_RAT_TENANT_ID && can("members", "read");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Anggota"
        description={canViewProvisional
          ? "Buka baris untuk melihat detail. Anggota ber-ID TMP dapat dikoreksi sebelum diterbitkan."
          : "Klik baris untuk melihat simpanan dan pinjaman anggota tanpa meninggalkan daftar."}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canReviewRegistrations && <GenerateQrModal />}
            {can("members", "create") && <QuotaBadge hint={quota("members")} noun="anggota" />}
            {can("members", "create") && (
              <Button onClick={() => navigate("/members/new")} disabled={quota("members")?.blocked}>
                <UserPlus aria-hidden="true" />
                Tambah anggota
              </Button>
            )}
          </div>
        }
      />

      {canReviewRegistrations || canViewProvisional ? (
        <Tabs defaultValue={canViewProvisional && params.get("tab") === "belum-terverifikasi" ? "provisional" : "list"}>
          <TabsList aria-label="Daftar anggota">
            <TabsTrigger value="list">Daftar anggota</TabsTrigger>
            {canViewProvisional && <TabsTrigger value="provisional">Belum terverifikasi</TabsTrigger>}
            {canReviewRegistrations && <TabsTrigger value="registrations">Pendaftaran mandiri</TabsTrigger>}
          </TabsList>
          <TabsContent value="list">
            <MembersListTab tenantId={canViewProvisional ? tenantId : undefined} />
          </TabsContent>
          {canViewProvisional && (
            <TabsContent value="provisional">
              <MembersListTab tenantId={tenantId} provisionalOnly />
            </TabsContent>
          )}
          {canReviewRegistrations && (
            <TabsContent value="registrations">
              <RegistrationRequestsTab />
            </TabsContent>
          )}
        </Tabs>
      ) : (
        <MembersListTab />
      )}
    </div>
  );
}
