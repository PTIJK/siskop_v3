import { Link } from "react-router-dom";
import type { QuotaHint } from "@/lib/entitlements";
import { cn } from "@/lib/utils";

/** "10/50" beside a create button; when the limit is reached, says so and points at the Subscription page. */
export function QuotaBadge({ hint, noun }: { hint: QuotaHint | null; noun: string }) {
  if (!hint) return null;
  const { meter, blocked } = hint;
  return (
    <span
      className={cn(
        "text-xs",
        blocked ? "font-medium text-destructive" : meter.state === "near" ? "text-warning" : "text-muted-foreground"
      )}
      title={`Pemakaian ${noun} pada paket Anda`}
    >
      {hint.label} {noun}
      {blocked && (
        <>
          {" · "}
          <Link to="/langganan" className="underline">
            Tingkatkan paket
          </Link>
        </>
      )}
    </span>
  );
}
