import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatRupiah, formatTanggalPendek } from '../../lib/utils';
import { usePermissions } from '../../hooks/usePermissions';
import { DataTable, ColumnDef } from '../../components/shared/DataTable';
import { PageHeader } from '../../components/shared/PageHeader';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import { PiggyBank } from 'lucide-react';

interface Saving {
  id: string;
  member: { fullName: string; memberId: string };
  savingConfig: { name: string; type: string };
  accountNumber: string;
  balance: string;
  lastTransactionAt?: string;
  isActive: boolean;
}

export function SavingsPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [data, setData] = useState<Saving[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const limit = 20;

  useEffect(() => {
    setIsLoading(true);
    api
      .get('/api/savings', {
        params: { page, limit, search, ...(typeFilter ? { type: typeFilter } : {}) },
      })
      .then((res) => {
        setData(res.data.data.items);
        setTotal(res.data.data.meta.total);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [page, search, typeFilter]);

  const columns: ColumnDef<Saving>[] = [
    { header: 'Anggota', cell: ({ row }) => (
      <div>
        <p className="font-medium">{row.original.member.fullName}</p>
        <p className="text-xs text-muted-foreground font-mono">{row.original.member.memberId}</p>
      </div>
    )},
    { header: 'No. Rekening', accessorKey: 'accountNumber', className: 'font-mono text-xs' },
    { header: 'Jenis Simpanan', cell: ({ row }) => (
      <div>
        <p className="text-sm">{row.original.savingConfig.name}</p>
        <Badge variant="secondary" className="text-xs">{row.original.savingConfig.type}</Badge>
      </div>
    )},
    { header: 'Saldo', cell: ({ row }) => (
      <span className="font-semibold">{formatRupiah(row.original.balance)}</span>
    )},
    { header: 'Transaksi Terakhir', cell: ({ row }) => (
      row.original.lastTransactionAt ? formatTanggalPendek(row.original.lastTransactionAt) : '-'
    )},
    { header: 'Status', cell: ({ row }) => (
      <Badge variant={row.original.isActive ? 'default' : 'secondary'}>
        {row.original.isActive ? 'Aktif' : 'Nonaktif'}
      </Badge>
    )},
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Simpanan"
        description="Daftar rekening simpanan anggota"
        actions={
          can('savings', 'create') && (
            <Button onClick={() => navigate('/savings/new')}>
              <PiggyBank className="mr-2 h-4 w-4" /> Buka Rekening
            </Button>
          )
        }
      />

      <div className="flex items-center gap-3">
        <Select value={typeFilter || 'all'} onValueChange={(v) => { setTypeFilter(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Semua Jenis" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Jenis</SelectItem>
            <SelectItem value="POKOK">Simpanan Pokok</SelectItem>
            <SelectItem value="WAJIB">Simpanan Wajib</SelectItem>
            <SelectItem value="SUKARELA">Simpanan Sukarela</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={data}
        isLoading={isLoading}
        search={{ value: search, onChange: (v) => { setSearch(v); setPage(1); }, placeholder: 'Cari nama anggota...' }}
        pagination={{ page, limit, total, onPageChange: setPage }}
        onRowClick={(row) => navigate(`/savings/${row.id}`)}
        emptyMessage="Belum ada rekening simpanan"
      />
    </div>
  );
}
