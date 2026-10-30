import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Status badges never rely on colour alone: ok/warn/bad/info each carry a
 * distinct marker shape (circle, diamond, triangle, square) plus text.
 */
const badgeVariants = cva(
  "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-[7px] border px-2.5 text-xs font-bold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground",
        accent: "border-transparent bg-accent text-accent-foreground",
        ok: "border-transparent bg-success/[0.13] text-success",
        warn: "border-transparent bg-warning/15 text-warning",
        bad: "border-transparent bg-destructive/[0.13] text-destructive",
        info: "border-transparent bg-info/[0.13] text-info",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const STATUS_MARKER: Record<"ok" | "warn" | "bad" | "info", string> = {
  ok: "h-[7px] w-[7px] rounded-full bg-current",
  warn: "h-[7px] w-[7px] rotate-45 rounded-[1px] bg-current",
  bad: "h-2 w-2 bg-current [clip-path:polygon(50%_0,100%_100%,0_100%)]",
  info: "h-[7px] w-[7px] rounded-[1px] bg-current",
}

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, children, ...props }: BadgeProps) {
  const marker = variant === "ok" || variant === "warn" || variant === "bad" || variant === "info" ? variant : null
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {marker ? <span aria-hidden="true" className={cn("inline-block shrink-0", STATUS_MARKER[marker])} /> : null}
      {children}
    </div>
  )
}

export { Badge, badgeVariants }
