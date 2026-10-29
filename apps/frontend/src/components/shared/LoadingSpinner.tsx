import { cn } from "../../lib/utils";
import { Skeleton } from "../ui/skeleton";

const SIZE_CLASSES = {
  sm: "h-4 w-4 border-2",
  md: "h-8 w-8 border-4",
  lg: "h-12 w-12 border-4"
};

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function LoadingSpinner({ size = "md", className }: LoadingSpinnerProps) {
  return (
    <div className={cn("flex items-center justify-center", className)}>
      <div className={cn("animate-spin rounded-full border-primary border-t-transparent", SIZE_CLASSES[size])} aria-hidden="true" />
    </div>
  );
}

/** Route-level loading: a skeleton shaped like a typical page (title, tiles, table) rather than a spinner. */
export function PageLoading() {
  return (
    <div role="status" aria-label="Memuat halaman" aria-busy="true" className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-24 rounded-[16px]" />
        <Skeleton className="h-24 rounded-[16px]" />
        <Skeleton className="h-24 rounded-[16px]" />
      </div>
      <Skeleton className="h-64 w-full rounded-[16px]" />
    </div>
  );
}
