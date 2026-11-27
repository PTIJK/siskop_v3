import type { ComponentProps } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function ExcelSelect({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <span className="relative block">
      <select {...props} className={cn("min-h-11 w-full cursor-pointer appearance-none rounded-md border border-input bg-card py-2 pl-3 pr-10 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60", className)}>
        {children}
      </select>
      <ChevronDown aria-hidden="true" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}

export function ExcelDateInput({ className, ...props }: Omit<ComponentProps<typeof Input>, "onClick">) {
  return (
    <span className="relative block">
      <Input {...props} type="date" onClick={(event) => {
        try { event.currentTarget.showPicker?.(); } catch { /* The native control still handles keyboard and browser fallback. */ }
      }}
      className={cn("min-h-11 cursor-pointer pr-10 disabled:cursor-not-allowed [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:m-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0", className)} />
      <CalendarDays aria-hidden="true" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}
