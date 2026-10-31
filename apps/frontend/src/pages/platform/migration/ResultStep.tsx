import type { MigrationResult } from "@siskop/types";
import { Button } from "@/components/ui/button";

export function ResultStep({ result, onAnother }: { result: MigrationResult; onAnother: () => void }) {
  return (
    <div className="space-y-4 rounded-lg border bg-card p-5">
      <p className="text-lg font-bold">Migrasi selesai: {result.slug}</p>
      <ul className="list-disc pl-5 text-sm">
        {result.counts.map((c) => (
          <li key={c.sheet}>
            {c.sheet}: {c.rows}
          </li>
        ))}
        <li>Nomor jurnal Saldo Awal Migrasi: {result.openingEntryNo ?? "-"}</li>
      </ul>
      <p className="text-sm text-muted-foreground">
        Langkah berikut: atur paket langganan di halaman Koperasi, serahkan kata sandi admin lewat jalur aman, lalu minta admin mencocokkan
        Neraca per tanggal cut-off.
      </p>
      <Button onClick={onAnother}>Migrasi koperasi lain</Button>
    </div>
  );
}
