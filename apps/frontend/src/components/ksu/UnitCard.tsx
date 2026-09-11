import { Link } from "react-router-dom";
import type { CooperativeUnit } from "@siskop/types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { UNIT_TYPE_ICON, UNIT_TYPE_LABEL } from "@/lib/unitTypeMeta";

// Clickable through to the per-unit detail shell (pages/ksu/UnitLayout.tsx at
// /ksu/units/:unitId) — `Link` rather than an onClick + useNavigate, matching
// the click-through convention DataTable rows already use elsewhere
// (e.g. MembersPage navigates on row click). Wrapping the whole Card keeps
// the existing static layout/markup unchanged.
export function UnitCard({ unit }: { unit: CooperativeUnit }) {
  const Icon = UNIT_TYPE_ICON[unit.type];

  return (
    <Link to={`/ksu/units/${unit.id}`} className="block">
      <Card className={cn("transition-all hover:border-primary/40 hover:shadow-md", !unit.isActive && "opacity-60")}>
        <CardContent className="flex items-center gap-3 p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-foreground">{unit.name}</p>
            <div className="mt-1 flex items-center gap-2">
              <Badge variant="outline">{UNIT_TYPE_LABEL[unit.type]}</Badge>
              {!unit.isActive && <Badge variant="secondary">Nonaktif</Badge>}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
