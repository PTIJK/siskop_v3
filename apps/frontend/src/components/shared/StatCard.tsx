import { type LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import { cn } from "../../lib/utils";

interface StatCardProps {
  title: string;
  value: string;
  /** Delta or note, e.g. "Naik 2,1% dari September". Shown with a trend icon and words. */
  subtitle?: string;
  icon: LucideIcon;
  iconColor?: string;
  trend?: "up" | "down" | "neutral";
  onClick?: () => void;
  isLoading?: boolean;
  alert?: boolean;
}

const TREND_ICONS = {
  up: TrendingUp,
  down: TrendingDown,
  neutral: Minus
};

const TREND_COLORS = {
  up: "text-success",
  down: "text-destructive",
  neutral: "text-muted-foreground"
};

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = "text-accent-foreground",
  trend,
  onClick,
  isLoading,
  alert
}: StatCardProps) {
  if (isLoading) {
    return (
      <Card aria-busy="true">
        <CardContent className="p-[18px]">
          <div className="flex items-start justify-between">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-10 w-10 rounded-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const TrendIcon = trend ? TREND_ICONS[trend] : null;

  const body = (
    <CardContent className="p-[18px]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-muted-foreground">{title}</p>
          <p className={cn("mt-1 text-2xl font-extrabold leading-tight tracking-[-0.02em] tabular-nums", alert && "text-destructive")}>
            {value}
          </p>
          {(subtitle || TrendIcon) && (
            <div className="mt-1 flex items-center gap-1">
              {TrendIcon && <TrendIcon className={cn("h-3.5 w-3.5", trend ? TREND_COLORS[trend] : "")} aria-hidden="true" />}
              {subtitle && (
                <span className={cn("text-[12.5px] font-semibold", trend ? TREND_COLORS[trend] : "text-muted-foreground")}>
                  {subtitle}
                </span>
              )}
            </div>
          )}
        </div>
        <div className={cn("rounded-full bg-accent p-2.5", alert && "bg-destructive/[0.13]")}>
          <Icon className={cn("h-[18px] w-[18px]", alert ? "text-destructive" : iconColor)} aria-hidden="true" />
        </div>
      </div>
    </CardContent>
  );

  if (onClick) {
    return (
      <Card className={cn("transition-colors hover:bg-muted/40", alert && "border-destructive")}>
        <button type="button" onClick={onClick} className="block w-full rounded-[16px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {body}
        </button>
      </Card>
    );
  }

  return <Card className={cn(alert && "border-destructive")}>{body}</Card>;
}
