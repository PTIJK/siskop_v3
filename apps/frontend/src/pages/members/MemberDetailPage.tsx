import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../lib/api';
import { formatRupiah, formatTanggalIndonesia } from '../../lib/utils';
import { usePermissions } from '../../hooks/usePermissions';
import { PageHeader } from '../../components/shared/PageHeader';
import { KOLBadge } from '../../components/shared/KOLBadge';
import { PageLoading } from '../../components/shared/LoadingSpinner';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Edit, PiggyBank, CreditCard, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';

interface MemberDetail {
  id: string;
  memberId: string;
  fullName: string;
  nik: string;
  accountNumber: string;
  address: string;
  birthPlace: string;
  birthDate: string;
  occupation: string;
  isActive: boolean;
  ktpUrl?: string | null;
  createdAt: string;
  savings: {
    id: string;
    savingConfig: { name: string; type: string };
    balance: string;
    isActive: boolean;
  }[];
  loans: {
    id: string;
    loanConfig: { name: string };
    principalAmount: string;
    totalAmount: string;
    remainingAmount: string;
    termMonths: number;
    status: string;
    kolCategory: string;
    disbursedAt: string;
  }[];
}

export function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [ktpLightbox, setKtpLightbox] = useState(false);

  useEffect(() => {
    api
      .get(`/api/members/${id}`)
      .then((res) => setMember(res.data.data))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [id]);

  if (isLoading) return <PageLoading />;
  if (!member) return <p className="text-center text-muted-foreground">Anggota tidak ditemukan</p>;

  const activeLoan = member.loans[0];
  const totalSavings = member.savings.reduce((sum, s) => sum + parseFloat(s.balance), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={member.fullName}
        breadcrumb={[{ label: 'Anggota', href: '/members' }, { label: member.fullName }]}
        actions={
          can('members', 'update') && (
            <Button variant="outline" onClick={() => navigate(`/members/${id}/edit`)}>
              <Edit className="mr-2 h-4 w-4" /> Edit
            </Button>
          )
        }
      />

      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="font-mono">{member.memberId}</Badge>
        <Badge variant="outline" className="font-mono">Rek: {member.accountNumber}</Badge>
        <Badge variant={member.isActive ? 'default' : 'secondary'}>
          {member.isActive ? 'Aktif' : 'Nonaktif'}
        </Badge>
      </div>

      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info">Info Pribadi</TabsTrigger>
          <TabsTrigger value="savings">Simpanan</TabsTrigger>
          <TabsTrigger value="loans">Pinjaman</TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[
                  { label: 'NIK', value: member.nik },
                  { label: 'Pekerjaan', value: member.occupation },
                  { label: 'Tempat Lahir', value: member.birthPlace },
                  { label: 'Tanggal Lahir', value: member.birthDate ? formatTanggalIndonesia(member.birthDate) : '-' },
                  { label: 'Tgl. Daftar', value: formatTanggalIndonesia(member.createdAt) },
                ].map((item) => (
                  <div key={item.label}>
                    <dt className="text-xs text-muted-foreground">{item.label}</dt>
                    <dd className="mt-0.5 text-sm font-medium">{item.value}</dd>
                  </div>
                ))}
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Alamat</dt>
                  <dd className="mt-0.5 text-sm font-medium">{member.address}</dd>
                </div>
              </dl>

              {member.ktpUrl && (
                <div className="mt-6">
                  <p className="mb-2 text-xs text-muted-foreground">Foto KTP</p>
                  <img
                    src={member.ktpUrl}
                    alt="KTP"
                    className="h-32 w-48 cursor-pointer rounded-md border object-cover hover:opacity-80"
                    onClick={() => setKtpLightbox(true)}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="savings" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Saldo Simpanan</p>
              <p className="text-2xl font-bold">{formatRupiah(totalSavings)}</p>
            </div>
            {can('savings', 'create') && (
              <Button onClick={() => navigate(`/savings/new?memberId=${id}`)}>
                <PiggyBank className="mr-2 h-4 w-4" /> Buka Rekening
              </Button>
            )}
          </div>
          {member.savings.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <PiggyBank className="mx-auto mb-2 h-8 w-8" />
                <p className="text-sm">Belum ada rekening simpanan</p>
              </CardContent>
            </Card>
          ) : (
            member.savings.map((s) => (
              <Card key={s.id} className="cursor-pointer hover:shadow-sm" onClick={() => navigate(`/savings/${s.id}`)}>
                <CardContent className="flex items-center justify-between p-5">
                  <div>
                    <p className="text-sm font-medium">{s.savingConfig.name}</p>
                    <Badge variant="secondary" className="mt-1 text-xs">{s.savingConfig.type}</Badge>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold">{formatRupiah(s.balance)}</p>
                    <div className="mt-1 flex gap-2 justify-end">
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); navigate(`/savings/${s.id}`); }}>
                        <ArrowDownCircle className="mr-1 h-3 w-3" /> Setor
                      </Button>
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); navigate(`/savings/${s.id}`); }}>
                        <ArrowUpCircle className="mr-1 h-3 w-3" /> Tarik
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="loans" className="mt-4 space-y-4">
          {!activeLoan && can('loans', 'create') && (
            <div className="flex justify-end">
              <Button onClick={() => navigate(`/loans/new?memberId=${id}`)}>
                <CreditCard className="mr-2 h-4 w-4" /> Ajukan Pinjaman
              </Button>
            </div>
          )}
          {activeLoan ? (
            <Card
              className="cursor-pointer hover:shadow-sm"
              onClick={() => navigate(`/loans/${activeLoan.id}`)}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{activeLoan.loanConfig.name}</CardTitle>
                    <div className="mt-1 flex gap-2">
                      <Badge>{activeLoan.status}</Badge>
                      <KOLBadge category={activeLoan.kolCategory} />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Pokok</dt>
                    <dd className="font-semibold">{formatRupiah(activeLoan.principalAmount)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Total</dt>
                    <dd className="font-semibold">{formatRupiah(activeLoan.totalAmount)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Sisa</dt>
                    <dd className="font-semibold text-orange-600">{formatRupiah(activeLoan.remainingAmount)}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <CreditCard className="mx-auto mb-2 h-8 w-8" />
                <p className="text-sm">Tidak ada pinjaman aktif</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* KTP Lightbox */}
      {ktpLightbox && member.ktpUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setKtpLightbox(false)}
        >
          <img src={member.ktpUrl} alt="KTP" className="max-h-[90vh] max-w-[90vw] rounded-lg" />
        </div>
      )}
    </div>
  );
}
