import type { CapitalDashboard, KspClass, LoanQualityDashboard } from "@siskop/types";
import { EQUITY_CLASS_LABELS } from "@siskop/types";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatRupiah, formatRupiahSingkat } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SERIES, STATUS } from "./chartColors";

const KSP_CLASS_LABEL: Record<KspClass, string> = { KSP_I: "KSP I", KSP_II: "KSP II", KSP_III: "KSP III", KSP_IV: "KSP IV" };
const KOL_LABEL: Record<string, string> = {
  LANCAR: "Lancar",
  DALAM_PERHATIAN: "Dalam perhatian",
  KURANG_LANCAR: "Kurang lancar",
  DIRAGUKAN: "Diragukan",
  MACET: "Macet"
};
const CAPITAL_RATIO_MIN = 10;
const NPL_MAX = 5;

function percent(value: string | null): string {
  return value === null ? "—" : `${Number(value).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
}

/** A labelled state chip: status color never carries meaning alone. */
function StateChip({ ok, okLabel, badLabel }: { ok: boolean; okLabel: string; badLabel: string }) {
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground">
      <Icon className="h-3.5 w-3.5" style={{ color: ok ? STATUS.good : STATUS.critical }} aria-hidden />
      {ok ? okLabel : badLabel}
    </span>
  );
}

/** A horizontal bar: `pct` of the track filled, `marker` (optional) drawn as a benchmark tick. */
function Meter({ pct, marker, color = SERIES.primary, label }: { pct: number; marker?: number; color?: string; label: string }) {
  return (
    <div className="relative h-2 w-full rounded-full bg-muted" role="meter" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-2 rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: color }} />
      {marker !== undefined && (
        <div className="absolute top-[-3px] h-3.5 w-0.5 bg-foreground/60" style={{ left: `${Math.min(100, marker)}%` }} aria-hidden />
      )}
    </div>
  );
}

function CardSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-2 w-full" />
      </CardContent>
    </Card>
  );
}

export function HealthSection({ capital, quality }: { capital?: CapitalDashboard; quality?: LoanQualityDashboard }) {
  return (
    <section className="space-y-3" aria-labelledby="health-heading">
      <h2 id="health-heading" className="text-sm font-semibold text-muted-foreground">
        Kesehatan Keuangan
      </h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {capital ? <ModalSendiriCard capital={capital} /> : <CardSkeleton />}
        {quality ? <NplCard quality={quality} /> : <CardSkeleton />}
        {quality ? <LdrCard quality={quality} /> : <CardSkeleton />}
      </div>
    </section>
  );
}

function ModalSendiriCard({ capital }: { capital: CapitalDashboard }) {
  const ratio = capital.rasioModalSendiriAset === null ? null : Number(capital.rasioModalSendiriAset);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          Modal Sendiri
          <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground" title="Klasifikasi usaha, Permenkop UKM 8/2023 Pasal 49">
            {KSP_CLASS_LABEL[capital.klasifikasi]}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-2xl font-bold tabular-nums">{formatRupiah(capital.modalSendiri)}</p>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Rasio terhadap total aset</span>
            <span className="font-medium text-foreground tabular-nums">{percent(capital.rasioModalSendiriAset)}</span>
          </div>
          <Meter pct={ratio ?? 0} marker={CAPITAL_RATIO_MIN} label="Rasio modal sendiri terhadap aset" />
          {ratio !== null && (
            <StateChip ok={ratio >= CAPITAL_RATIO_MIN} okLabel={`Di atas acuan ${CAPITAL_RATIO_MIN}%`} badLabel={`Di bawah acuan ${CAPITAL_RATIO_MIN}%`} />
          )}
        </div>
        {capital.komposisi.length > 0 && (
          <dl className="space-y-1 border-t pt-2 text-xs">
            {capital.komposisi.map((k) => (
              <div key={k.equityClass} className="flex justify-between">
                <dt className="text-muted-foreground">{EQUITY_CLASS_LABELS[k.equityClass]}</dt>
                <dd className="tabular-nums">{formatRupiahSingkat(Number(k.amount))}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function NplCard({ quality }: { quality: LoanQualityDashboard }) {
  const total = Number(quality.totalOutstanding);
  const npl = quality.nplRatio === null ? null : Number(quality.nplRatio);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Kualitas Pinjaman (NPL)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between">
          <p className="text-2xl font-bold tabular-nums">{percent(quality.nplRatio)}</p>
          {npl !== null && <StateChip ok={npl <= NPL_MAX} okLabel={`≤ ${NPL_MAX}% wajar`} badLabel={`> ${NPL_MAX}% perlu tindakan`} />}
        </div>
        <ul className="space-y-1.5" aria-label="Outstanding per kolektibilitas">
          {quality.byKol.map((k) => {
            const share = total > 0 ? (Number(k.outstanding) / total) * 100 : 0;
            return (
              <li key={k.category} className="space-y-0.5">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">
                    {KOL_LABEL[k.category]} ({k.count})
                  </span>
                  <span className="tabular-nums">{formatRupiahSingkat(Number(k.outstanding))}</span>
                </div>
                <Meter pct={share} label={`${KOL_LABEL[k.category]} ${share.toFixed(1)}%`} />
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function LdrCard({ quality }: { quality: LoanQualityDashboard }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Pinjaman terhadap Simpanan (LDR)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-2xl font-bold tabular-nums">{percent(quality.ldr)}</p>
        <p className="text-xs text-muted-foreground">
          Outstanding {formatRupiah(quality.totalOutstanding)} dibanding simpanan yang bisa ditarik anggota (sukarela/berjangka).
          Simpanan pokok dan wajib adalah modal, tidak dihitung.
        </p>
        {quality.topOverdue.length > 0 && (
          <div className="border-t pt-2">
            <p className="mb-1 text-xs font-medium">Tunggakan terbesar</p>
            <ul className="space-y-1 text-xs">
              {quality.topOverdue.map((l) => (
                <li key={l.loanId} className="flex justify-between gap-2">
                  <span className="truncate">
                    {l.memberName} <span className="text-muted-foreground">· {KOL_LABEL[l.kolCategory] ?? l.kolCategory}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{formatRupiahSingkat(Number(l.outstanding))}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ComplianceSection({ capital }: { capital?: CapitalDashboard }) {
  if (!capital) return null;
  const borrowers = capital.bmpp.topBorrowers.filter((b) => b.usagePct !== null);
  return (
    <section className="space-y-3" aria-labelledby="compliance-heading">
      <h2 id="compliance-heading" className="text-sm font-semibold text-muted-foreground">
        Kepatuhan (Permenkop UKM 8/2023 &amp; 2/2024)
      </h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Batas Konsentrasi Pinjaman (BMPP)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {borrowers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {Number(capital.modalSendiri) > 0 ? "Belum ada pinjaman aktif." : "Belum ada modal sendiri tercatat di buku besar."}
              </p>
            ) : (
              <ul className="space-y-2">
                {borrowers.map((b) => {
                  const usage = Number(b.usagePct);
                  return (
                    <li key={b.memberId} className="space-y-0.5">
                      <div className="flex justify-between gap-2 text-xs">
                        <span className="truncate">
                          {b.memberName}{" "}
                          <span className="text-muted-foreground">· {b.isRelatedParty ? "pengurus/pengawas, batas 10%" : "batas 15%"}</span>
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {formatRupiahSingkat(Number(b.principal))} / {formatRupiahSingkat(Number(b.limit))} ({percent(b.usagePct)})
                        </span>
                      </div>
                      <Meter pct={usage} marker={80} color={usage >= 100 ? STATUS.critical : SERIES.primary} label={`${b.memberName} ${percent(b.usagePct)} dari batas`} />
                    </li>
                  );
                })}
              </ul>
            )}
            {capital.konsentrasiSimpanan.length > 0 && (
              <div className="border-t pt-2 text-xs">
                <StateChip ok={false} okLabel="" badLabel="Simpanan pokok+wajib anggota melebihi 20% modal sendiri:" />
                <ul className="mt-1 space-y-0.5">
                  {capital.konsentrasiSimpanan.map((k) => (
                    <li key={k.memberId} className="flex justify-between">
                      <span>{k.memberName}</span>
                      <span className="tabular-nums">
                        {formatRupiahSingkat(Number(k.amount))} ({percent(k.pctOfModalSendiri)})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Ambang Audit Akuntan Publik</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {capital.audit.applies ? (
              <>
                <p className="text-2xl font-bold tabular-nums">{percent(capital.audit.progressPct)}</p>
                <Meter pct={Number(capital.audit.progressPct)} label="Progres menuju ambang audit" color={capital.audit.reached ? STATUS.warning : SERIES.primary} />
                <p className="text-xs text-muted-foreground">
                  Modal sendiri {formatRupiahSingkat(Number(capital.modalSendiri))} dari ambang {formatRupiahSingkat(Number(capital.audit.threshold))}{" "}
                  (Pasal 12).
                </p>
                <StateChip ok={!capital.audit.reached} okLabel="Belum wajib audit" badLabel="Wajib diaudit akuntan publik" />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Ambang Rp5 miliar berlaku untuk koperasi dengan unit simpan pinjam.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
