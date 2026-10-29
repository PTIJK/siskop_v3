import type { ReactNode } from "react";

/** Interlocked-rings mark, same shape as the staff app's sidebar logo. */
export function BrandMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden="true">
      <circle cx="12" cy="16" r="8" stroke="hsl(var(--primary))" strokeWidth="3" />
      <circle cx="20" cy="16" r="8" stroke="hsl(var(--brand))" strokeWidth="3" />
    </svg>
  );
}

/** Centered card shell shared by every unauthenticated member screen. */
export function MemberAuthLayout({
  title,
  description,
  children,
  footer
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <BrandMark />
          <span className="text-xl font-extrabold tracking-tight">SISKOP</span>
        </div>
        <div className="rounded-[16px] border bg-card p-6">
          <h1 className="text-[22px] font-extrabold leading-tight tracking-[-0.02em]">{title}</h1>
          {description ? <div className="mt-1.5 text-sm text-muted-foreground">{description}</div> : null}
          <div className="mt-5">{children}</div>
        </div>
        {footer ? <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div> : null}
      </div>
    </main>
  );
}
