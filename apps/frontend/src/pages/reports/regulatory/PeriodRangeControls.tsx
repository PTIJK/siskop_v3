import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { FileText } from 'lucide-react';

interface PeriodRangeControlsProps {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export function PeriodRangeControls({ from, to, onFromChange, onToChange, onSubmit, isLoading }: PeriodRangeControlsProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label className="text-xs">Dari</Label>
        <Input type="date" value={from} onChange={(e) => onFromChange(e.target.value)} className="w-40" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Sampai</Label>
        <Input type="date" value={to} onChange={(e) => onToChange(e.target.value)} className="w-40" />
      </div>
      <Button onClick={onSubmit} disabled={isLoading}>
        <FileText className="mr-2 h-4 w-4" />
        {isLoading ? 'Memuat...' : 'Tampilkan'}
      </Button>
    </div>
  );
}
