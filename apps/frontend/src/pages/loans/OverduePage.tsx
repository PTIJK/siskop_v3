import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatRupiah, formatTanggalPendek } from '../../lib/utils';
import { DataTable, ColumnDef } from '../../components/shared/DataTable';
import { PageHeader } from '../../components/shared/PageHeader';
import { KOLBadge } from '../../components/shared/KOLBadge';
import { Button } from '../../components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { KOLCategory } from '@siskop/shared';
import { cn } from '../../lib/utils';

interface OverdueLoan {
  id: string;
  member: { fullName: string; memberId: string };
  loanConfig: { name: string };
  remainingAmount: string;
  kolCategory: string;
  daysOverdue: number;
  lastPaymentAt?: string;
}

const KOL_ORDER = [KOLCategory.MACET, KOLCategory.DIRAGUKAN, KOLCategory.KURANG_LANCAR, KOLCategory.DALAM_PERHATIAN];

const ROW_TINT: Record<string, string> = {
  MACET: 'bg-red-50 hover:bg-red-100',
  DIRAGUKAN: 'bg-orange-50 hover:bg-orange-100',
};

export function OverduePage() {
  const navigate = useNavigate();
  const [data, setData] = useState<OverdueLoan[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api.get('/api/loans/overdue')
      .then((res) => {
        const items = (res.data.data.items ?? res.data.data) as OverdueLoan[];
        const sorted = [...items].sort((a, b) => KOL_ORDER.indexOf(a.kolCategory as KOLCategory) - KOL_ORDER.indexOf(b.kolCategory as KOLCategory));
        setData(sorted);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  const columns: ColumnDef<OverdueLoan>[] = [
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
    { header: 'Sisa Pinjaman', cell: ({ row }) => <span className="font-semibold">{formatRupiah(row.original.remainingAmount)}</span> },
    { header: 'KOL', cell: ({ row }) => <KOLBadge category={row.original.kolCategory} /> },
    {
      header: 'Hari Terlambat',
      cell: ({ row }) => (
        <span className={cn('font-semibold', row.original.daysOverdue > 180 ? 'text-red-600' : 'text-orange-600')}>
          {row.original.daysOverdue} hari
        </span>
      ),
    },
    {
      header: 'Bayar Terakhir',
      cell: ({ row }) => row.original.lastPaymentAt ? formatTanggalPendek(row.original.lastPaymentAt) : '-',
    },
    {
      header: 'Aksi',
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => { e.stopPropagation(); navigate(`/loans/${row.original.id}`); }}
        >
          Detail
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Anggota Menunggak"
        description="Pinjaman dengan status bermasalah (non-LANCAR)"
        breadcrumb={[{ label: 'Pinjaman', href: '/loans' }, { label: 'Menunggak' }]}
      />

      {data.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-red-600" />
          <p className="text-sm font-medium text-red-800">
            {data.length} pinjaman memerlukan perhatian segera
          </p>
        </div>
      )}

      <DataTable
        columns={columns}
        data={data}
        isLoading={isLoading}
        onRowClick={(row) => navigate(`/loans/${row.id}`)}
        emptyMessage="Tidak ada pinjaman bermasalah"
      />
    </div>
  );
}
