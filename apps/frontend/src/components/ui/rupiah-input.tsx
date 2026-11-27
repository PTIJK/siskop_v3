import { Input } from "@/components/ui/input";
import { groupThousands, parseRupiahEdit, parseRupiahPaste } from "@/lib/money-input";
import type { ComponentProps } from "react";

type RupiahInputProps = Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type" | "inputMode"> & {
  value: string;
  onValueChange: (decimal: string) => void;
  maxIntegerDigits?: number;
};

export function RupiahInput({ value, onValueChange, maxIntegerDigits = 15, ...props }: RupiahInputProps) {
  const [whole = "", cents] = value.split(".");

  function update(display: string, typedDecimalAt?: number) {
    const next = parseRupiahEdit(display, maxIntegerDigits, typedDecimalAt);
    if (next !== undefined) onValueChange(next);
  }

  return <Input
    {...props}
    type="text"
    inputMode="decimal"
    value={groupThousands(whole) + (cents === undefined ? "" : `,${cents}`)}
    onChange={(event) => {
      const field = event.currentTarget;
      const input = event.nativeEvent as InputEvent;
      const decimalAt = input.data === "." && field.selectionStart !== null ? field.selectionStart - 1 : undefined;
      update(field.value, decimalAt);
    }}
    onPaste={(event) => {
      event.preventDefault();
      const next = parseRupiahPaste(event.clipboardData.getData("text"), maxIntegerDigits);
      if (next !== undefined) onValueChange(next);
    }}
  />;
}
