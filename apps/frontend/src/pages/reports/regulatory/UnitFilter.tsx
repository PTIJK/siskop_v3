import { useAccessibleUnits } from "@/hooks/useAccessibleUnits";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ALL_UNITS } from "./unit";

interface UnitFilterProps {
  value: string;
  onChange: (unitId: string) => void;
}

// Cuts Neraca / Arus Kas / Hasil Usaha to one unit, or leaves them consolidated ("Semua unit").
// Pembagian SHU and CALK are cooperative-level statements and have no unit filter. Renders
// nothing for a single-unit koperasi — there is nothing to choose between.
export function UnitFilter({ value, onChange }: UnitFilterProps) {
  const { data: units } = useAccessibleUnits();
  if (!units || units.length <= 1) return null;

  return (
    <div className="space-y-1">
      <Label className="text-xs">Unit usaha</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_UNITS}>Semua unit (konsolidasi)</SelectItem>
          {units.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.name}
              {u.isActive ? "" : " (nonaktif)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
