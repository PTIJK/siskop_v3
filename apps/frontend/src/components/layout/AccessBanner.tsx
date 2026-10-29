import { Link, useLocation } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { useSubscription } from "@/hooks/useEntitlements";
import { accessNotice } from "@/lib/entitlements";

/** Shown across the app while the server is refusing the koperasi because of its payment standing. */
export function AccessBanner() {
  const { data } = useSubscription();
  const { pathname } = useLocation();
  const notice = accessNotice(data);
  if (!notice) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive min-[901px]:px-6">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{notice.message}</span>
      {pathname !== "/langganan" && (
        <Link to="/langganan" className="font-bold underline">
          Lihat tagihan
        </Link>
      )}
    </div>
  );
}
