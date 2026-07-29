import { Lock } from "lucide-react";

interface EntitlementNoticeProps {
  message: string;
}

/** Shown in place of a module's content when its API call fails with FEATURE_NOT_ENTITLED — see middleware/entitlement.ts. */
export function EntitlementNotice({ message }: EntitlementNoticeProps) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <Lock className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{message}</p>
    </div>
  );
}
