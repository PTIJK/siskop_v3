import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { isFeatureNotEntitled } from '../../../lib/api';
import { formatRupiah } from '../../../lib/utils';
import { PageLoading } from '../../../components/shared/LoadingSpinner';
import { NotEntitledNotice } from '../../../components/shared/NotEntitledNotice';
import { Card, CardContent } from '../../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { FileText, Info } from 'lucide-react';
import { PeriodRangeControls } from './PeriodRangeControls';
import { ShuDistribution, defaultPeriodFrom, defaultPeriodTo } from './types';

export function ShuDistribusiTab() {
  const [from, setFrom] = useState(defaultPeriodFrom());
  const [to, setTo] = useState(defaultPeriodTo());
  const [data, setData] = useState<ShuDistribution | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [notEntitled, setNotEntitled] = useState(false);

  const fetchReport = async () => {
    setIsLoading(true);
    setNotEntitled(false);
    try {
      const res = await api.get('/api/reports/regulatory/shu-distribution', { params: { from, to } });
      setData(res.data.data);
    } catch (err) {
      if (isFeatureNotEntitled(err)) setNotEntitled(true);
    } finally {
      setIsLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchReport(); }, []);

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="pt-5">
          <PeriodRangeControls from={from} to={to} onFromChange={setFrom} onToChange={setTo} onSubmit={fetchReport} isLoading={isLoading} />
        </CardContent>
      </Card>

      {isLoading ? (
        <PageLoading />
      ) : notEntitled ? (
        <NotEntitledNotice />
      ) : data?.catatan ? (
        <Card>
          <CardContent className="flex items-start gap-3 py-6 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p>{data.catatan}</p>
              {!data.alokasi && (
                <Link to="/config/shu-distribution" className="mt-1 inline-block text-primary hover:underline">
                  Buka Konfigurasi SHU
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      ) : data ? (
        <>
          <p className="text-sm text-muted-foreground">Periode {data.periode.from} — {data.periode.to}</p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.alokasi && [
              { label: 'Jasa Simpanan', bucket: data.alokasi.jasaSimpanan },
              { label: 'Jasa Pinjaman', bucket: data.alokasi.jasaPinjaman },
              { label: 'Cadangan', bucket: data.alokasi.cadangan },
              { label: 'Lainnya', bucket: data.alokasi.lainnya },
            ].map((item) => (
              <Card key={item.label}>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">{item.label} ({item.bucket.percent}%)</p>
                  <p className="mt-1 text-lg font-bold">{formatRupiah(item.bucket.total)}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardContent className="pt-5">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Anggota</TableHead>
                    <TableHead className="text-right">Rata-rata Saldo Simpanan</TableHead>
                    <TableHead className="text-right">Bunga/Margin Dibayar</TableHead>
                    <TableHead className="text-right">Jasa Simpanan</TableHead>
                    <TableHead className="text-right">Jasa Pinjaman</TableHead>
                    <TableHead className="text-right">Total SHU</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.anggota.map((a) => (
                    <TableRow key={a.memberId}>
                      <TableCell>
                        {a.fullName} <span className="text-xs text-muted-foreground">({a.memberCode})</span>
                      </TableCell>
                      <TableCell className="text-right">{formatRupiah(a.avgSavingsBalance)}</TableCell>
                      <TableCell className="text-right">{formatRupiah(a.interestPaid)}</TableCell>
                      <TableCell className="text-right">{formatRupiah(a.jasaSimpanan)}</TableCell>
                      <TableCell className="text-right">{formatRupiah(a.jasaPinjaman)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatRupiah(a.totalShu)}</TableCell>
                    </TableRow>
                  ))}
                  {data.totalDibagikanKeAnggota && (
                    <TableRow className="font-semibold">
                      <TableCell colSpan={5}>Total Dibagikan ke Anggota</TableCell>
                      <TableCell className="text-right">{formatRupiah(data.totalDibagikanKeAnggota)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
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
