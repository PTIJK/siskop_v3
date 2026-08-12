import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Small custom implementation (not Radix) — the desktop TabsList pattern was
// rated low-risk in the UI audit for a *small* tab count (this component's
// only Fase 1 use, MemberDetailPage's Info/Simpanan/Pinjaman, is 3 short
// labels), so it's kept, just reimplemented lightly rather than pulling in
// @radix-ui/react-tabs for one screen.
interface Tab {
  value: string;
  label: string;
  content: ReactNode;
}

export function Tabs({ tabs, defaultValue }: { tabs: Tab[]; defaultValue: string }) {
  const [active, setActive] = useState(defaultValue);
  const activeTab = tabs.find((t) => t.value === active);

  return (
    <div>
      <div className="flex gap-1 rounded-md bg-muted p-1">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActive(tab.value)}
            className={cn(
              "flex-1 rounded-sm px-2 py-1.5 text-xs font-medium transition-colors",
              active === tab.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="mt-4">{activeTab?.content}</div>
    </div>
  );
}
