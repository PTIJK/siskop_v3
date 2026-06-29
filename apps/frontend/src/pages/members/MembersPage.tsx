import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatTanggalPendek } from '../../lib/utils';
import { usePermissions } from '../../hooks/usePermissions';
import { DataTable, ColumnDef } from '../../components/shared/DataTable';
import { PageHeader } from '../../components/shared/PageHeader';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { UserPlus } from 'lucide-react';

interface Member {
  id: string;
  memberId: string;
  fullName: string;
  nik: string;
  accountNumber: string;
  occupation: string;
  isActive: boolean;
  createdAt: string;
}

export function MembersPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [data, setData] = useState<Member[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const limit = 20;

  useEffect(() => {
    setIsLoading(true);
    api
      .get('/api/tenant/members', { params: { page, limit, search } })
      .then((res) => {
        setData(res.data.data.items);
        setTotal(res.data.data.meta.total);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [page, search]);

  const columns: ColumnDef<Member>[] = [
    { header: 'ID Anggota', accessorKey: 'memberId', className: 'font-mono text-xs' },
    { header: 'Nama Lengkap', accessorKey: 'fullName' },
    { header: 'NIK', accessorKey: 'nik', className: 'font-mono text-xs' },
    { header: 'No. Rekening', accessorKey: 'accountNumber', className: 'font-mono text-xs' },
    { header: 'Pekerjaan', accessorKey: 'occupation' },
    {
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? 'default' : 'secondary'}>
          {row.original.isActive ? 'Aktif' : 'Nonaktif'}
        </Badge>
      ),
    },
    {
      header: 'Tgl. Daftar',
      cell: ({ row }) => formatTanggalPendek(row.original.createdAt),
    },
    {
      header: 'Aksi',
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => { e.stopPropagation(); navigate(`/members/${row.original.id}`); }}
          >
            Detail
          </Button>
          {can('members', 'update') && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => { e.stopPropagation(); navigate(`/members/${row.original.id}/edit`); }}
            >
              Edit
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Anggota"
        description="Daftar anggota koperasi"
        actions={
          can('members', 'create') && (
            <Button onClick={() => navigate('/members/new')}>
              <UserPlus className="mr-2 h-4 w-4" />
              Tambah Anggota
            </Button>
          )
        }
      />

      <DataTable
        columns={columns}
        data={data}
        isLoading={isLoading}
        search={{ value: search, onChange: (v) => { setSearch(v); setPage(1); }, placeholder: 'Cari nama, NIK, ID...' }}
        pagination={{ page, limit, total, onPageChange: setPage }}
        onRowClick={(row) => navigate(`/members/${row.id}`)}
        emptyMessage="Belum ada anggota terdaftar"
      />
    </div>
  );
}
