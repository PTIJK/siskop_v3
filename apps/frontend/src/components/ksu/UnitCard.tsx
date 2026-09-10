import type { CooperativeType, CooperativeUnit } from "@siskop/types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Handshake, Landmark, Store, Truck, Wheat, type LucideIcon } from "lucide-react";

const UNIT_TYPE_ICON: Record<CooperativeType, LucideIcon> = {
  KSP: Landmark,
  KONSUMEN: Store,
  PRODUSEN: Wheat,
  JASA: Handshake,
  PEMASARAN: Truck
};

const UNIT_TYPE_LABEL: Record<CooperativeType, string> = {
  KSP: "Simpan Pinjam",
  KONSUMEN: "Konsumen",
  PRODUSEN: "Produsen",
  JASA: "Jasa",
  PEMASARAN: "Pemasaran"
};

export function UnitCard({ unit }: { unit: CooperativeUnit }) {
  const Icon = UNIT_TYPE_ICON[unit.type];

  return (
    <Card className={cn("transition-all", !unit.isActive && "opacity-60")}>
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
  );
}
