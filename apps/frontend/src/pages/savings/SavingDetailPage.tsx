import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../lib/api';
import { formatRupiah, formatTanggalPendek } from '../../lib/utils';
import { usePermissions } from '../../hooks/usePermissions';
import { PageHeader } from '../../components/shared/PageHeader';
import { PageLoading } from '../../components/shared/LoadingSpinner';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { useToast } from '../../components/hooks/use-toast';
import { ArrowDownCircle, ArrowUpCircle, AlertTriangle } from 'lucide-react';

interface Transaction {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  amount: string;
  note?: string;
  createdAt: string;
  performedBy?: { name: string };
}

interface SavingDetail {
  id: string;
  member: { id: string; fullName: string; memberId: string };
  savingConfig: { name: string; type: string; rateType: string; rate: string };
  accountNumber: string;
  balance: string;
  isActive: boolean;
  createdAt: string;
}

type ActionType = 'deposit' | 'withdraw' | null;

export function SavingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = usePermissions();
  const { toast } = useToast();
  const [saving, setSaving] = useState<SavingDetail | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [action, setAction] = useState<ActionType>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchData = () => {
    Promise.all([
      api.get(`/api/savings/${id}`),
      api.get(`/api/savings/${id}/transactions`),
    ])
      .then(([sRes, tRes]) => {
        setSaving(sRes.data.data);
        setTransactions(tRes.data.data);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, [id]);

  const handleTransaction = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    setIsSubmitting(true);
    try {
      const endpoint = action === 'deposit' ? 'deposit' : 'withdraw';
      await api.post(`/api/savings/${id}/${endpoint}`, {
        amount: parseFloat(amount),
        note: note || undefined,
      });
      toast({ title: action === 'deposit' ? 'Setoran berhasil' : 'Penarikan berhasil' });
      setAction(null);
      setAmount('');
      setNote('');
      fetchData();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      toast({ title: 'Gagal', description: axiosErr?.response?.data?.error?.message ?? 'Terjadi kesalahan', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) return <PageLoading />;
  if (!saving) return <p className="text-center text-muted-foreground">Rekening tidak ditemukan</p>;

  const isPOKOK = saving.savingConfig.type === 'POKOK';

  return (
    <div className="space-y-6">
      <PageHeader
        title={saving.savingConfig.name}
        breadcrumb={[{ label: 'Simpanan', href: '/savings' }, { label: saving.savingConfig.name }]}
      />

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                {saving.member.fullName} — {saving.member.memberId}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground font-mono">Rek: {saving.accountNumber}</p>
              <div className="mt-2 flex gap-2">
                <Badge variant="secondary">{saving.savingConfig.type}</Badge>
                <Badge variant="outline">{saving.savingConfig.rateType} {saving.savingConfig.rate}%</Badge>
              </div>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-xs text-muted-foreground">Saldo</p>
              <p className="text-3xl font-bold text-primary">{formatRupiah(saving.balance)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Sejak {formatTanggalPendek(saving.createdAt)}
              </p>
            </div>
          </div>

          {can('savings', 'create') && (
            <div className="mt-5 flex gap-3">
              <Button variant="outline" onClick={() => setAction('deposit')}>
                <ArrowDownCircle className="mr-2 h-4 w-4 text-green-600" /> Setor
              </Button>
              <Button variant="outline" onClick={() => setAction('withdraw')}>
                <ArrowUpCircle className="mr-2 h-4 w-4 text-orange-600" /> Tarik
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transaction History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Riwayat Transaksi</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal</TableHead>
                <TableHead>Jenis</TableHead>
                <TableHead className="text-right">Nominal</TableHead>
                <TableHead>Catatan</TableHead>
                <TableHead>Petugas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground text-sm">
                    Belum ada transaksi
                  </TableCell>
                </TableRow>
              ) : (
                transactions.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-sm">{formatTanggalPendek(t.createdAt)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={t.type === 'DEPOSIT' ? 'default' : 'secondary'}
                        className={t.type === 'DEPOSIT' ? 'bg-green-100 text-green-800 hover:bg-green-100' : 'bg-orange-100 text-orange-800 hover:bg-orange-100'}
                      >
                        {t.type === 'DEPOSIT' ? 'Setoran' : 'Penarikan'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      <span className={t.type === 'DEPOSIT' ? 'text-green-700' : 'text-orange-700'}>
                        {t.type === 'DEPOSIT' ? '+' : '-'}{formatRupiah(t.amount)}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{t.note ?? '-'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{t.performedBy?.name ?? '-'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Transaction Dialog */}
      <Dialog open={!!action} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {action === 'deposit' ? 'Setor Dana' : 'Tarik Dana'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {action === 'withdraw' && isPOKOK && (
              <div className="flex items-start gap-2 rounded-md bg-yellow-50 p-3 text-sm text-yellow-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Simpanan pokok tidak dapat ditarik jika ada pinjaman aktif.
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Nominal</Label>
              <Input
                type="number"
                placeholder="0"
                min="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Catatan (opsional)</Label>
              <Textarea
                rows={2}
                placeholder="Keterangan transaksi"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)}>Batal</Button>
            <Button onClick={handleTransaction} disabled={isSubmitting || !amount}>
              {isSubmitting ? 'Memproses...' : 'Konfirmasi'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
