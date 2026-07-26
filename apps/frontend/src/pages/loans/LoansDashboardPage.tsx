import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatRupiah } from '../../lib/utils';
import { usePermissions } from '../../hooks/usePermissions';
import { DataTable, ColumnDef } from '../../components/shared/DataTable';
import { PageHeader } from '../../components/shared/PageHeader';
import { KOLBadge } from '../../components/shared/KOLBadge';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import { AlertTriangle, Plus } from 'lucide-react';

interface LoanConfigOption {
  id: string;
  name: string;
  isActive: boolean;
}

interface Loan {
  id: string;
  member: { memberId: string; fullName: string };
  loanConfig: { name: string };
  principalAmount: string;
  totalAmount: string;
  monthlyPayment: string;
  remainingAmount: string;
  termMonths: number;
  status: string;
  kolCategory: string;
  disbursedAt?: string;
}

function LoansTable({
  status,
  search,
  onSearchChange,
  loanConfigId,
}: {
  status?: string;
  search: string;
  onSearchChange: (value: string) => void;
  loanConfigId?: string;
}) {
  const navigate = useNavigate();
  const [data, setData] = useState<Loan[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  const limit = 20;

  useEffect(() => { setPage(1); }, [status, search, loanConfigId]);

  useEffect(() => {
    setIsLoading(true);
    api
      .get('/api/loans', {
        params: {
          page,
          limit,
          search,
          ...(status ? { status } : {}),
          ...(loanConfigId ? { loanConfigId } : {}),
        },
      })
      .then((res) => {
        setData(res.data.data);
        setTotal(res.data.meta.total);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [page, search, status, loanConfigId]);

  const columns: ColumnDef<Loan>[] = [
    {
      header: 'Anggota',
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.member.fullName}</p>
          <p className="font-mono text-xs text-muted-foreground">{row.original.member.memberId}</p>
        </div>
      ),
    },
    { header: 'Jenis Pembiayaan', cell: ({ row }) => row.original.loanConfig.name },
    { header: 'Pokok', cell: ({ row }) => formatRupiah(row.original.principalAmount) },
    { header: 'Total', cell: ({ row }) => formatRupiah(row.original.totalAmount) },
    { header: 'Angsuran/bln', cell: ({ row }) => formatRupiah(row.original.monthlyPayment) },
    { header: 'Sisa', cell: ({ row }) => (
      <span className="font-semibold text-orange-600">{formatRupiah(row.original.remainingAmount)}</span>
    )},
    { header: 'Tenor', cell: ({ row }) => `${row.original.termMonths} bln` },
    {
      header: 'Status',
      cell: ({ row }) => <Badge variant="outline">{row.original.status}</Badge>,
    },
    { header: 'KOL', cell: ({ row }) => <KOLBadge category={row.original.kolCategory} /> },
  ];

  return (
    <DataTable
      columns={columns}
      data={data}
      isLoading={isLoading}
      pagination={{ page, limit, total, onPageChange: setPage }}
      onRowClick={(row) => navigate(`/loans/${row.id}`)}
      emptyMessage="Belum ada data pinjaman"
      search={{ value: search, onChange: onSearchChange, placeholder: 'Cari nama, ID anggota...' }}
    />
  );
}

export function LoansDashboardPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [overdueCount, setOverdueCount] = useState(0);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [loanConfigs, setLoanConfigs] = useState<LoanConfigOption[]>([]);

  useEffect(() => {
    api.get('/api/loans/overdue').then((res) => {
      setOverdueCount(Array.isArray(res.data.data) ? res.data.data.length : 0);
    }).catch(console.error);

    api.get('/api/loans/configs').then((res) => setLoanConfigs(res.data.data)).catch(console.error);
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pinjaman"
        description="Kelola pinjaman anggota koperasi"
        actions={
          can('loans', 'create') && (
            <Button onClick={() => navigate('/loans/new')}>
              <Plus className="mr-2 h-4 w-4" /> Ajukan Pinjaman
            </Button>
          )
        }
      />

      {overdueCount > 0 && (
        <div
          className="flex cursor-pointer items-center gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3"
          onClick={() => navigate('/loans/overdue')}
        >
          <AlertTriangle className="h-5 w-5 text-red-600" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800">
              {overdueCount} anggota memiliki pinjaman bermasalah (MACET/DIRAGUKAN)
            </p>
          </div>
          <span className="text-xs text-red-600 underline">Lihat detail →</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Select value={typeFilter || 'all'} onValueChange={(v) => setTypeFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Semua Jenis Pembiayaan" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Jenis Pembiayaan</SelectItem>
            {loanConfigs.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">Semua Pinjaman</TabsTrigger>
          <TabsTrigger value="active">Aktif</TabsTrigger>
          <TabsTrigger value="completed">Lunas</TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="mt-4">
          <LoansTable search={search} onSearchChange={setSearch} loanConfigId={typeFilter} />
        </TabsContent>
        <TabsContent value="active" className="mt-4">
          <LoansTable status="ACTIVE" search={search} onSearchChange={setSearch} loanConfigId={typeFilter} />
        </TabsContent>
        <TabsContent value="completed" className="mt-4">
          <LoansTable status="COMPLETED" search={search} onSearchChange={setSearch} loanConfigId={typeFilter} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
