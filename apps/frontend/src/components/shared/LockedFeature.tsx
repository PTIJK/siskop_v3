import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface LockedFeatureProps {
  /** Feature name as the user knows it, e.g. "Koperasi Pasar". */
  featureName: string;
  /** Current package name, when known. */
  packageName?: string;
  /** One sentence: what the feature does. */
  description?: string;
  /** Packages that include the feature, cheapest first. */
  unlockedBy?: readonly string[];
  /** "page" fills the content area; "inline" replaces one section. */
  variant?: "page" | "inline";
  className?: string;
}

/**
 * The single "not in your package" pattern (design.md §9.4). Never a dead link:
 * the primary action goes to the Langganan page, the secondary one home.
 */
export function LockedFeature({ featureName, packageName, description, unlockedBy, variant = "page", className }: LockedFeatureProps) {
  const title = `${featureName} belum termasuk di ${packageName ? `paket ${packageName}` : "paket Anda"}`;
  const where = unlockedBy && unlockedBy.length > 0 ? `Tersedia di paket ${unlockedBy.join(", ")}.` : null;

  if (variant === "inline") {
    return (
      <div role="note" className={cn("flex items-start gap-3 rounded-[12px] border bg-muted/50 p-4", className)}>
        <Lock className="mt-0.5 h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-bold">{title}</p>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          {where ? <p className="text-sm text-muted-foreground">{where}</p> : null}
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/langganan">Lihat paket</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("relative isolate overflow-clip rounded-[20px] border bg-card", className)}>
      <div aria-hidden="true" className="absolute inset-0 -z-10 space-y-4 p-8 opacity-60 blur-[6px]">
        <div className="h-8 w-1/3 rounded-md bg-muted" />
        <div className="grid grid-cols-3 gap-4">
          <div className="h-24 rounded-[14px] bg-muted" />
          <div className="h-24 rounded-[14px] bg-muted" />
          <div className="h-24 rounded-[14px] bg-muted" />
        </div>
        <div className="h-48 rounded-[14px] bg-muted" />
      </div>
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Lock className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        {where ? <p className="text-sm font-semibold">{where}</p> : null}
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button asChild variant="brand">
            <Link to="/langganan">Lihat paket</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link to="/dashboard">Kembali ke beranda</Link>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Hanya pengurus yang berwenang yang dapat mengubah paket. Data koperasi Anda tidak berubah.
        </p>
      </div>
    </div>
  );
}
