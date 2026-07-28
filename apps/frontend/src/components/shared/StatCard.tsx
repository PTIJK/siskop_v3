import { type LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { Skeleton } from "../ui/skeleton";
import { cn } from "../../lib/utils";

interface StatCardProps {
  title: string;
  value: string;
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
  up: "text-green-600",
  down: "text-red-600",
  neutral: "text-muted-foreground"
};

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = "text-primary",
  trend,
  onClick,
  isLoading,
  alert
}: StatCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div className="space-y-2 flex-1">
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

  return (
    <Card
      className={cn(
        "transition-all",
        onClick && "cursor-pointer hover:shadow-md",
        alert && "animate-pulse border-red-500 ring-1 ring-red-500"
      )}
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className={cn("mt-1 text-2xl font-bold tracking-tight", alert && "text-red-600")}>{value}</p>
            {(subtitle || TrendIcon) && (
              <div className="mt-1 flex items-center gap-1">
                {TrendIcon && <TrendIcon className={cn("h-3 w-3", trend ? TREND_COLORS[trend] : "")} />}
                {subtitle && (
                  <span className={cn("text-xs", trend ? TREND_COLORS[trend] : "text-muted-foreground")}>
                    {subtitle}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className={cn("rounded-full bg-muted p-2.5", alert && "bg-red-50")}>
            <Icon className={cn("h-5 w-5", iconColor)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
