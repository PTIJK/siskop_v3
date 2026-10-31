import { Link } from "react-router-dom";
import type { AttentionItem } from "@siskop/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEVERITY_LABEL } from "./dashboardView";

const VARIANT = { critical: "destructive", warning: "secondary", info: "outline" } as const;

export function AttentionPanel({ items }: { items: AttentionItem[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Perlu perhatian</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Tidak ada yang perlu ditindaklanjuti.</p>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-sm">
                <Badge variant={VARIANT[item.severity]} className="mt-0.5 shrink-0">
                  {SEVERITY_LABEL[item.severity]}
                </Badge>
                {item.href ? (
                  <Link to={item.href} className="underline-offset-2 hover:underline">
                    {item.message}
                  </Link>
                ) : (
                  <span>{item.message}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
