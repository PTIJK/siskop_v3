import { useEffect, useState } from 'react';
import { Building2, Users, Activity, CreditCard } from 'lucide-react';
import api from '../../lib/api';
import { PageHeader } from '../../components/shared/PageHeader';
import { StatCard } from '../../components/shared/StatCard';

interface PlatformStats {
  totalTenants: number;
  activeTenants: number;
  totalMembers: number;
  totalTransactions30d: number;
}

export function AdminDashboardPage() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api
      .get('/api/admin/dashboard')
      .then((res) => setStats(res.data.data))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard Platform"
        description="Statistik keseluruhan platform SISKOP"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Koperasi"
          value={String(stats?.totalTenants ?? 0)}
          icon={Building2}
          isLoading={isLoading}
        />
        <StatCard
          title="Koperasi Aktif"
          value={String(stats?.activeTenants ?? 0)}
          icon={Activity}
          iconColor="text-green-600"
          isLoading={isLoading}
        />
        <StatCard
          title="Total Anggota"
          value={String(stats?.totalMembers ?? 0)}
          icon={Users}
          isLoading={isLoading}
        />
        <StatCard
          title="Transaksi (30 Hari)"
          value={String(stats?.totalTransactions30d ?? 0)}
          icon={CreditCard}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}
