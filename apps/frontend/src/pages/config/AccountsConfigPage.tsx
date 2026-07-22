import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '../../lib/api';
import { PageHeader } from '../../components/shared/PageHeader';
import { FormError } from '../../components/shared/FormError';
import { ConfirmDialog } from '../../components/shared/ConfirmDialog';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Checkbox } from '../../components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { useToast } from '../../components/hooks/use-toast';
import { Plus, Power, Sparkles } from 'lucide-react';
import { Account, AccountCategory, MappingTransactionKind } from '@siskop/shared';

interface AccountMappingRow {
  id: string;
  sourceType: 'SAVING_CONFIG' | 'LOAN_CONFIG' | 'SYSTEM';
  sourceId: string | null;
  transactionKind: MappingTransactionKind;
  debitAccountId: string;
  creditAccountId: string;
}

interface SourceConfig {
  id: string;
  name: string;
  isActive: boolean;
}

const CATEGORY_LABEL: Record<AccountCategory, string> = {
  [AccountCategory.ASET]: 'Aset',
  [AccountCategory.KEWAJIBAN]: 'Kewajiban',
  [AccountCategory.EKUITAS]: 'Ekuitas',
  [AccountCategory.PENDAPATAN]: 'Pendapatan',
  [AccountCategory.BEBAN]: 'Beban',
};

const KIND_LABEL: Record<MappingTransactionKind, string> = {
  [MappingTransactionKind.DEPOSIT]: 'Setoran',
  [MappingTransactionKind.WITHDRAWAL]: 'Penarikan',
  [MappingTransactionKind.DISBURSEMENT]: 'Pencairan',
  [MappingTransactionKind.PAYMENT_PRINCIPAL]: 'Pembayaran Pokok',
  [MappingTransactionKind.PAYMENT_INTEREST]: 'Pembayaran Bunga/Margin',
  [MappingTransactionKind.PAYMENT_PENALTY]: 'Denda',
};

const SAVING_KINDS: MappingTransactionKind[] = [
  MappingTransactionKind.DEPOSIT,
  MappingTransactionKind.WITHDRAWAL,
];
const LOAN_KINDS: MappingTransactionKind[] = [
  MappingTransactionKind.DISBURSEMENT,
  MappingTransactionKind.PAYMENT_PRINCIPAL,
  MappingTransactionKind.PAYMENT_INTEREST,
  MappingTransactionKind.PAYMENT_PENALTY,
];

const accountSchema = z.object({
  code: z.string().min(3, 'Kode akun wajib diisi, contoh: 1-1500'),
  name: z.string().min(2, 'Nama minimal 2 karakter'),
  category: z.nativeEnum(AccountCategory),
  isHeader: z.boolean(),
});

type AccountFormData = z.infer<typeof accountSchema>;

function apiErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
  return axiosErr?.response?.data?.error?.message ?? fallback;
}

export function AccountsConfigPage() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [mappings, setMappings] = useState<AccountMappingRow[]>([]);
  const [savingConfigs, setSavingConfigs] = useState<SourceConfig[]>([]);
  const [loanConfigs, setLoanConfigs] = useState<SourceConfig[]>([]);
  const [completeness, setCompleteness] = useState<{ total: number; mapped: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [addDialog, setAddDialog] = useState(false);
  const [apiError, setApiError] = useState('');
  const [deactivateTarget, setDeactivateTarget] = useState<Account | null>(null);
  const [seeding, setSeeding] = useState(false);

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } =
    useForm<AccountFormData>({
      resolver: zodResolver(accountSchema),
      defaultValues: { code: '', name: '', category: AccountCategory.ASET, isHeader: false },
    });

  const fetchAll = () => {
    setIsLoading(true);
    Promise.all([
      api.get('/api/config/accounts', { params: { limit: 200 } }),
      api.get('/api/config/account-mappings'),
      api.get('/api/config/account-mappings/completeness'),
      api.get('/api/savings/configs'),
      api.get('/api/loans/configs'),
    ])
      .then(([accRes, mapRes, completenessRes, savingRes, loanRes]) => {
        setAccounts(accRes.data.data);
        setMappings(mapRes.data.data);
        setCompleteness(completenessRes.data.data);
        setSavingConfigs(savingRes.data.data);
        setLoanConfigs(loanRes.data.data);
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(() => { fetchAll(); }, []);

  const postableAccounts = useMemo(() => accounts.filter((a) => !a.isHeader && a.isActive), [accounts]);
  const accountsByCategory = useMemo(() => {
    const grouped = new Map<AccountCategory, Account[]>();
    for (const acc of accounts) {
      const list = grouped.get(acc.category) ?? [];
      list.push(acc);
      grouped.set(acc.category, list);
    }
    return grouped;
  }, [accounts]);

  const mappingKey = (sourceType: string, sourceId: string | null, kind: string) =>
    `${sourceType}:${sourceId}:${kind}`;

  const mappingLookup = useMemo(() => {
    const map = new Map<string, AccountMappingRow>();
    for (const m of mappings) {
      map.set(mappingKey(m.sourceType, m.sourceId, m.transactionKind), m);
    }
    return map;
  }, [mappings]);

  const openAdd = () => {
    reset({ code: '', name: '', category: AccountCategory.ASET, isHeader: false });
    setApiError('');
    setAddDialog(true);
  };

  const onSubmitAccount = async (data: AccountFormData) => {
    setApiError('');
    try {
      await api.post('/api/config/accounts', data);
      toast({ title: 'Akun berhasil ditambahkan' });
      setAddDialog(false);
      fetchAll();
    } catch (err) {
      setApiError(apiErrorMessage(err, 'Gagal menyimpan akun'));
    }
  };

  const seedDefault = async () => {
    setSeeding(true);
    try {
      await api.post('/api/config/accounts/seed-default');
      toast({ title: 'Template COA standar berhasil diisi' });
      fetchAll();
    } catch (err) {
      toast({ title: 'Gagal mengisi template', description: apiErrorMessage(err, ''), variant: 'destructive' });
    } finally {
      setSeeding(false);
    }
  };

  const confirmDeactivate = async () => {
    if (!deactivateTarget) return;
    try {
      await api.delete(`/api/config/accounts/${deactivateTarget.id}`);
      toast({ title: 'Akun berhasil dinonaktifkan' });
      setDeactivateTarget(null);
      fetchAll();
    } catch (err) {
      toast({
        title: 'Gagal menonaktifkan akun',
        description: apiErrorMessage(err, ''),
        variant: 'destructive',
      });
      setDeactivateTarget(null);
    }
  };

  const toggleCashEquivalent = async (acc: Account, value: boolean) => {
    try {
      await api.post(`/api/config/accounts/${acc.id}/mark-cash-equivalent`, { isCashEquivalent: value });
      toast({ title: value ? 'Akun ditandai sebagai kas & setara kas' : 'Penandaan kas & setara kas dihapus' });
      fetchAll();
    } catch (err) {
      toast({ title: 'Gagal memperbarui akun', description: apiErrorMessage(err, ''), variant: 'destructive' });
    }
  };

  const updateMapping = async (
    sourceType: 'SAVING_CONFIG' | 'LOAN_CONFIG',
    sourceId: string,
    transactionKind: MappingTransactionKind,
    side: 'debitAccountId' | 'creditAccountId',
    accountId: string
  ) => {
    const existing = mappingLookup.get(mappingKey(sourceType, sourceId, transactionKind));
    const debitAccountId = side === 'debitAccountId' ? accountId : existing?.debitAccountId;
    const creditAccountId = side === 'creditAccountId' ? accountId : existing?.creditAccountId;
    if (!debitAccountId || !creditAccountId) return; // wait until both sides are chosen

    try {
      await api.put('/api/config/account-mappings', {
        sourceType,
        sourceId,
        transactionKind,
        debitAccountId,
        creditAccountId,
      });
      toast({ title: 'Pemetaan berhasil disimpan' });
      fetchAll();
    } catch (err) {
      toast({ title: 'Gagal menyimpan pemetaan', description: apiErrorMessage(err, ''), variant: 'destructive' });
    }
  };

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Konfigurasi Akun"
        description="Bagan akun (Chart of Accounts) dan pemetaan transaksi simpanan/pinjaman ke akun"
      />

      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts">Daftar Akun</TabsTrigger>
          <TabsTrigger value="mappings">Pemetaan Transaksi</TabsTrigger>
        </TabsList>

        {/* ── Daftar Akun ─────────────────────────────────────────────────────── */}
        <TabsContent value="accounts" className="space-y-4">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {accounts.length === 0 && (
              <Button variant="outline" onClick={seedDefault} disabled={seeding}>
                <Sparkles className="mr-2 h-4 w-4" />
                {seeding ? 'Mengisi...' : 'Isi COA Standar'}
              </Button>
            )}
            <Button onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" /> Tambah Akun
            </Button>
          </div>

          {accounts.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Belum ada akun. Gunakan tombol &quot;Isi COA Standar&quot; untuk memulai dengan template baku,
                atau tambahkan akun secara manual.
              </CardContent>
            </Card>
          ) : (
            [AccountCategory.ASET, AccountCategory.KEWAJIBAN, AccountCategory.EKUITAS, AccountCategory.PENDAPATAN, AccountCategory.BEBAN].map(
              (category) => {
                const list = accountsByCategory.get(category);
                if (!list || list.length === 0) return null;
                return (
                  <Card key={category}>
                    <CardContent className="pt-5">
                      <p className="mb-3 text-sm font-semibold">{CATEGORY_LABEL[category]}</p>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Kode</TableHead>
                            <TableHead>Nama Akun</TableHead>
                            <TableHead>Saldo Normal</TableHead>
                            <TableHead>Tipe</TableHead>
                            {category === AccountCategory.ASET && <TableHead>Kas &amp; Setara Kas</TableHead>}
                            <TableHead className="text-right">Aksi</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {list
                            .sort((a, b) => a.code.localeCompare(b.code))
                            .map((acc) => (
                              <TableRow key={acc.id} className={!acc.isActive ? 'opacity-50' : ''}>
                                <TableCell className="font-mono text-xs">{acc.code}</TableCell>
                                <TableCell>{acc.name}</TableCell>
                                <TableCell>{acc.normalBalance === 'DEBIT' ? 'Debit' : 'Kredit'}</TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap gap-1">
                                    {acc.isHeader && <Badge variant="secondary">Header</Badge>}
                                    {acc.isDefault && <Badge variant="outline">Bawaan</Badge>}
                                    {!acc.isActive && <Badge variant="destructive">Nonaktif</Badge>}
                                  </div>
                                </TableCell>
                                {category === AccountCategory.ASET && (
                                  <TableCell>
                                    <Checkbox
                                      checked={acc.isCashEquivalent}
                                      disabled={acc.isHeader || !acc.isActive}
                                      onCheckedChange={(checked) => toggleCashEquivalent(acc, checked === true)}
                                    />
                                  </TableCell>
                                )}
                                <TableCell className="text-right">
                                  {acc.isActive && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-8 w-8 text-orange-500"
                                      title="Nonaktifkan"
                                      onClick={() => setDeactivateTarget(acc)}
                                    >
                                      <Power className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                );
              }
            )
          )}
        </TabsContent>

        {/* ── Pemetaan Transaksi ──────────────────────────────────────────────── */}
        <TabsContent value="mappings" className="space-y-4">
          {completeness && (
            <Card>
              <CardContent className="flex items-center justify-between py-4">
                <p className="text-sm">
                  <span className="font-semibold">{completeness.mapped}</span> dari{' '}
                  <span className="font-semibold">{completeness.total}</span> jenis transaksi sudah dipetakan ke akun
                </p>
                <Badge variant={completeness.mapped === completeness.total && completeness.total > 0 ? 'default' : 'secondary'}>
                  {completeness.total === 0 ? 0 : Math.round((completeness.mapped / completeness.total) * 100)}%
                </Badge>
              </CardContent>
            </Card>
          )}

          {postableAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Tambahkan atau isi daftar akun terlebih dahulu sebelum memetakan transaksi.
            </p>
          ) : (
            <Card>
              <CardContent className="pt-5">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Konfigurasi</TableHead>
                      <TableHead>Jenis Transaksi</TableHead>
                      <TableHead>Akun Debit</TableHead>
                      <TableHead>Akun Kredit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {savingConfigs.filter((c) => c.isActive).flatMap((config) =>
                      SAVING_KINDS.map((kind) => {
                        const existing = mappingLookup.get(mappingKey('SAVING_CONFIG', config.id, kind));
                        return (
                          <TableRow key={`saving-${config.id}-${kind}`}>
                            <TableCell>{config.name}</TableCell>
                            <TableCell>{KIND_LABEL[kind]}</TableCell>
                            <TableCell>
                              <Select
                                value={existing?.debitAccountId ?? ''}
                                onValueChange={(v) => updateMapping('SAVING_CONFIG', config.id, kind, 'debitAccountId', v)}
                              >
                                <SelectTrigger className="w-56"><SelectValue placeholder="Pilih akun" /></SelectTrigger>
                                <SelectContent>
                                  {postableAccounts.map((acc) => (
                                    <SelectItem key={acc.id} value={acc.id}>{acc.code} — {acc.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Select
                                value={existing?.creditAccountId ?? ''}
                                onValueChange={(v) => updateMapping('SAVING_CONFIG', config.id, kind, 'creditAccountId', v)}
                              >
                                <SelectTrigger className="w-56"><SelectValue placeholder="Pilih akun" /></SelectTrigger>
                                <SelectContent>
                                  {postableAccounts.map((acc) => (
                                    <SelectItem key={acc.id} value={acc.id}>{acc.code} — {acc.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                    {loanConfigs.filter((c) => c.isActive).flatMap((config) =>
                      LOAN_KINDS.map((kind) => {
                        const existing = mappingLookup.get(mappingKey('LOAN_CONFIG', config.id, kind));
                        return (
                          <TableRow key={`loan-${config.id}-${kind}`}>
                            <TableCell>{config.name}</TableCell>
                            <TableCell>{KIND_LABEL[kind]}</TableCell>
                            <TableCell>
                              <Select
                                value={existing?.debitAccountId ?? ''}
                                onValueChange={(v) => updateMapping('LOAN_CONFIG', config.id, kind, 'debitAccountId', v)}
                              >
                                <SelectTrigger className="w-56"><SelectValue placeholder="Pilih akun" /></SelectTrigger>
                                <SelectContent>
                                  {postableAccounts.map((acc) => (
                                    <SelectItem key={acc.id} value={acc.id}>{acc.code} — {acc.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Select
                                value={existing?.creditAccountId ?? ''}
                                onValueChange={(v) => updateMapping('LOAN_CONFIG', config.id, kind, 'creditAccountId', v)}
                              >
                                <SelectTrigger className="w-56"><SelectValue placeholder="Pilih akun" /></SelectTrigger>
                                <SelectContent>
                                  {postableAccounts.map((acc) => (
                                    <SelectItem key={acc.id} value={acc.id}>{acc.code} — {acc.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Tambah Akun</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmitAccount)} className="space-y-4">
            {apiError && <FormError error={apiError} />}
            <div className="space-y-1.5">
              <Label>Kategori *</Label>
              <Select
                defaultValue={AccountCategory.ASET}
                onValueChange={(v) => setValue('category', v as AccountCategory)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.values(AccountCategory).map((cat) => (
                    <SelectItem key={cat} value={cat}>{CATEGORY_LABEL[cat]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Kode Akun *</Label>
              <Input placeholder="1-1500" {...register('code')} />
              {errors.code && <p className="text-xs text-destructive">{errors.code.message}</p>}
              <p className="text-xs text-muted-foreground">
                Kode harus diawali sesuai prefiks kategori (mis. 1- untuk Aset) dan tidak dapat diubah setelah dibuat.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Nama Akun *</Label>
              <Input placeholder="Kas Kecil" {...register('name')} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="isHeader"
                checked={watch('isHeader')}
                onCheckedChange={(checked) => setValue('isHeader', checked === true)}
              />
              <Label htmlFor="isHeader" className="cursor-pointer font-normal">
                Akun header/group (tidak dapat digunakan langsung dalam pemetaan)
              </Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddDialog(false)}>Batal</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Menyimpan...' : 'Simpan'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(o) => !o && setDeactivateTarget(null)}
        title={`Nonaktifkan akun "${deactivateTarget?.name}"?`}
        description="Akun bawaan atau akun yang masih digunakan pada pemetaan transaksi tidak dapat dinonaktifkan."
        confirmLabel="Nonaktifkan"
        variant="destructive"
        onConfirm={confirmDeactivate}
      />
    </div>
  );
}
