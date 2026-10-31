import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface HelpHintProps {
  /** The explanation shown on hover, keyboard focus or tap. */
  children: React.ReactNode;
  /** Accessible name of the "?" button. */
  label?: string;
  className?: string;
}

/**
 * A small "?" that keeps long explanatory text out of the layout until asked for.
 * Opens on hover and keyboard focus (Esc closes) and also on tap/click for touch screens.
 */
export function HelpHint({ children, label = "Bantuan", className }: HelpHintProps) {
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onClick={() => setOpen(true)}
            className={cn(
              "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className
            )}
          >
            <CircleHelp className="h-4 w-4" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-xs whitespace-normal text-left font-normal leading-snug">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
