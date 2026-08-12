// Temporary stub for screens not yet built in this pass — keeps the bottom
// nav fully navigable (no 404/blank screen) while Members/Savings/Loans/
// Reports read-only views (docs/06-PRD-SISKOP-Mobile-Version.md §7) are
// implemented in a follow-up. Remove each usage as its real screen lands.
export function ComingSoonPage({ title }: { title: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs">Segera hadir</p>
    </div>
  );
}
