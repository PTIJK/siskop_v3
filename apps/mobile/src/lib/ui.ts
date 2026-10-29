// Shared class strings for form controls on the mobile app, which has no
// shadcn ui/ folder. Values follow apps/frontend ui/input.tsx and ui/button.tsx
// (design.md §8) with 48px touch targets for phones.
export const inputClass =
  "mt-1.5 flex h-12 w-full rounded-md border border-input bg-card px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-45 aria-[invalid=true]:border-destructive";

export const labelClass = "block text-[13px] font-bold text-foreground";

export const primaryButtonClass =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-primary px-[22px] text-[15px] font-bold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45";

export const outlineButtonClass =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-[12px] border border-input bg-card px-[22px] text-[15px] font-bold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45";

export const alertClass =
  "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm font-semibold text-destructive";
