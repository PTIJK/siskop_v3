import { Lock } from "lucide-react";

// Ported from apps/frontend/src/components/shared/EntitlementNotice.tsx —
// shown in place of a screen's content when its API call fails with
// FEATURE_NOT_ENTITLED (middleware/entitlement.ts). First needed for the
// regulatory reports (docs/06-PRD-SISKOP-Mobile-Version.md §7) — no other
// mobile screen so far has hit an entitlement-gated route.
export function EntitlementNotice({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
      <Lock className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{message}</p>
    </div>
  );
}
