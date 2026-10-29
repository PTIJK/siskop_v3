import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Member } from "@siskop/types";
import { apiFetchPage } from "@/api/client";
import { formatTanggalPendek } from "@/lib/format";
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

const LIMIT = 20;

function MembersListTab() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  // Row click opens the detail drawer; "Detail" still goes to the full page.
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["members", { page, search }],
    queryFn: () =>
      apiFetchPage<Member[]>(
        `/members?page=${page}&limit=${LIMIT}${search ? `&search=${encodeURIComponent(search)}` : ""}`
      )
  });

  const columns: ColumnDef<Member>[] = [
    { header: "ID Anggota", accessorKey: "memberId", className: "font-mono text-xs" },
    { header: "Nama Lengkap", accessorKey: "fullName" },
    { header: "NIK", accessorKey: "nik", className: "font-mono text-xs" },
    { header: "No. Rekening", accessorKey: "accountNumber", className: "font-mono text-xs" },
    { header: "Pekerjaan", accessorKey: "occupation" },
    {
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? "ok" : "info"}>
          {row.original.isActive ? "Aktif" : "Nonaktif"}
        </Badge>
      )
    },
    { header: "Tgl. Daftar", cell: ({ row }) => formatTanggalPendek(row.original.createdAt) },
    {
      header: "Aksi",
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/members/${row.original.id}`);
            }}
          >
            Detail
          </Button>
          {can("members", "update") && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/members/${row.original.id}/edit`);
              }}
            >
              Edit
            </Button>
          )}
        </div>
      )
    }
  ];

  return (
    <>
    <DataTable
      label="Daftar anggota"
      columns={columns}
      data={data?.items ?? []}
      isLoading={isPending}
      isError={isError}
      errorMessage={error instanceof Error ? error.message : undefined}
      onRetry={refetch}
      search={{
        value: search,
        onChange: (v) => {
          setSearch(v);
          setPage(1);
        },
        placeholder: "Cari nama, NIK, ID..."
      }}
      pagination={{ page, limit: LIMIT, total: data?.meta.total ?? 0, onPageChange: setPage }}
      onRowClick={(row) => setOpenId(row.id)}
      getRowKey={(row) => row.id}
      emptyMessage="Belum ada anggota terdaftar"
      emptyDescription="Tambah anggota pertama, atau bagikan QR pendaftaran agar calon anggota mendaftar sendiri."
    />
    <MemberDrawer memberId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

export function MembersPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { quota } = useEntitlements();
  const canReviewRegistrations = can("members", "create");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Anggota"
        description="Klik baris untuk melihat simpanan dan pinjaman anggota tanpa meninggalkan daftar."
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

      {canReviewRegistrations ? (
        <Tabs defaultValue="list">
          <TabsList>
            <TabsTrigger value="list">Daftar anggota</TabsTrigger>
            <TabsTrigger value="registrations">Pendaftaran mandiri</TabsTrigger>
          </TabsList>
          <TabsContent value="list">
            <MembersListTab />
          </TabsContent>
          <TabsContent value="registrations">
            <RegistrationRequestsTab />
          </TabsContent>
        </Tabs>
      ) : (
        <MembersListTab />
      )}
    </div>
  );
}
