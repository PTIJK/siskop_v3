import { cn } from "@/lib/utils";

export function LoadingSpinner({ className }: { className?: string }) {
  return (
    <div role="status" aria-label="Memuat" className={cn("flex items-center justify-center", className)}>
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-muted border-t-brand" />
    </div>
  );
}

export function PageLoading() {
  return (
    <div className="flex h-64 items-center justify-center">
      <LoadingSpinner />
    </div>
  );
}
