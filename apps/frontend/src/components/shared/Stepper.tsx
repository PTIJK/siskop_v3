import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface StepperProps {
  steps: readonly string[];
  /** Zero-based index of the active step. */
  current: number;
  className?: string;
}

/** Pill per step: the active one carries aria-current="step", finished ones show a check. */
export function Stepper({ steps, current, className }: StepperProps) {
  return (
    <nav aria-label="Langkah" className={className}>
      <ol className="flex flex-wrap gap-2">
        {steps.map((label, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li
              key={label}
              aria-current={active ? "step" : undefined}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] font-bold",
                active && "border-transparent bg-primary text-primary-foreground",
                done && "border-transparent bg-success/[0.13] text-success",
                !active && !done && "border-input bg-card text-muted-foreground"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-extrabold",
                  active ? "bg-primary-foreground/20" : done ? "bg-success/20" : "bg-muted"
                )}
              >
                {done ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              <span>{label}</span>
              {done ? <span className="sr-only">(selesai)</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
