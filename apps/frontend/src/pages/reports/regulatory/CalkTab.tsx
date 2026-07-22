import { useEffect, useState } from 'react';
import api from '../../../lib/api';
import { formatRupiah, formatTanggalIndonesia } from '../../../lib/utils';
import { usePermissions } from '../../../hooks/usePermissions';
import { useToast } from '../../../components/hooks/use-toast';
import { PageLoading } from '../../../components/shared/LoadingSpinner';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Textarea } from '../../../components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { FileText } from 'lucide-react';
import { PeriodRangeControls } from './PeriodRangeControls';
import {
  CALK_SECTION_LABEL,
  Calk,
  CalkMutasiItem,
  CalkSection,
  LabaRugiItem,
  apiErrorMessage,
  defaultPeriodFrom,
  defaultPeriodTo,
} from './types';

function MutasiTable({ title, items }: { title: string; items: CalkMutasiItem[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kode</TableHead>
              <TableHead>Nama Akun</TableHead>
              <TableHead className="text-right">Saldo Awal</TableHead>
              <TableHead className="text-right">Saldo Akhir</TableHead>
              <TableHead className="text-right">Mutasi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, i) => (
              <TableRow key={item.accountId ?? i}>
                <TableCell className="font-mono text-xs">{item.code ?? '—'}</TableCell>
                <TableCell>{item.name}</TableCell>
                <TableCell className="text-right">{formatRupiah(item.saldoAwal)}</TableCell>
                <TableCell className="text-right">{formatRupiah(item.saldoAkhir)}</TableCell>
                <TableCell className="text-right">{formatRupiah(item.mutasi)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function IncomeExpenseTable({ title, items }: { title: string; items: LabaRugiItem[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kode</TableHead>
              <TableHead>Nama Akun</TableHead>
              <TableHead className="text-right">Jumlah</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.accountId}>
                <TableCell className="font-mono text-xs">{item.code}</TableCell>
                <TableCell>{item.name}</TableCell>
                <TableCell className="text-right">{formatRupiah(item.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

const NARRATIVE_SECTIONS: CalkSection[] = ['UMUM', 'DASAR_PENYUSUNAN', 'KEBIJAKAN_AKUNTANSI', 'INFORMASI_TAMBAHAN'];

function NarrativeEditor({
  section,
  content,
  updatedAt,
  canEdit,
  onSaved,
}: {
  section: CalkSection;
  content: string;
  updatedAt: string | null;
  canEdit: boolean;
  onSaved: (section: CalkSection, content: string, updatedAt: string) => void;
}) {
  const { toast } = useToast();
  const [text, setText] = useState(content);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => { setText(content); }, [content]);

  const save = async () => {
    setIsSaving(true);
    try {
      const res = await api.put('/api/reports/regulatory/calk/narrative', { section, content: text });
      onSaved(section, text, res.data.data.updatedAt);
      toast({ title: 'Bagian CALK berhasil disimpan' });
    } catch (err) {
      toast({ title: 'Gagal menyimpan', description: apiErrorMessage(err, ''), variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{CALK_SECTION_LABEL[section]}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {canEdit ? (
          <>
            <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Belum diisi" />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {updatedAt ? `Terakhir diperbarui ${formatTanggalIndonesia(updatedAt)}` : 'Belum diisi'}
              </p>
              <Button size="sm" onClick={save} disabled={isSaving}>
                {isSaving ? 'Menyimpan...' : 'Simpan'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="whitespace-pre-wrap text-sm">{content || 'Belum diisi'}</p>
            <p className="text-xs text-muted-foreground">
              {updatedAt ? `Terakhir diperbarui ${formatTanggalIndonesia(updatedAt)}` : ''}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function CalkTab() {
  const { can } = usePermissions();
  const [from, setFrom] = useState(defaultPeriodFrom());
  const [to, setTo] = useState(defaultPeriodTo());
  const [data, setData] = useState<Calk | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchReport = async () => {
    setIsLoading(true);
    try {
      const res = await api.get('/api/reports/regulatory/calk', { params: { from, to } });
      setData(res.data.data);
    } finally {
      setIsLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchReport(); }, []);

  const handleNarrativeSaved = (section: CalkSection, content: string, updatedAt: string) => {
    setData((prev) => (prev ? { ...prev, narasi: { ...prev.narasi, [section]: { content, updatedAt } } } : prev));
  };

  const canEditNarrative = can('reports', 'update');

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="pt-5">
          <PeriodRangeControls from={from} to={to} onFromChange={setFrom} onToChange={setTo} onSubmit={fetchReport} isLoading={isLoading} />
        </CardContent>
      </Card>

      {isLoading ? (
        <PageLoading />
      ) : data ? (
        <>
          <p className="text-sm text-muted-foreground">Periode {data.periode.from} — {data.periode.to}</p>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Catatan Naratif</h2>
            {NARRATIVE_SECTIONS.map((section) => (
              <NarrativeEditor
                key={section}
                section={section}
                content={data.narasi[section].content}
                updatedAt={data.narasi[section].updatedAt}
                canEdit={canEditNarrative}
                onSaved={handleNarrativeSaved}
              />
            ))}
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Rincian Angka</h2>
            <MutasiTable title="Aset" items={data.rincianAset} />
            <MutasiTable title="Kewajiban" items={data.rincianKewajiban} />
            <MutasiTable title="Ekuitas" items={data.rincianEkuitas} />
            <IncomeExpenseTable title="Pendapatan" items={data.rincianPendapatan} />
            <IncomeExpenseTable title="Beban" items={data.rincianBeban} />
            <Card>
              <CardContent className="flex items-center justify-between py-4">
                <p className="text-sm font-semibold">SHU Berjalan</p>
                <p className="text-sm font-semibold">{formatRupiah(data.shuBerjalan)}</p>
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
          <FileText className="h-10 w-10" />
          <p className="text-sm">Pilih periode dan klik &quot;Tampilkan&quot;</p>
        </div>
      )}
    </div>
  );
}
