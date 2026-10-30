/**
 * Pure helpers behind MoneyInput. The canonical value is a string of digits
 * ("1250000"), never a float: it round-trips any rupiah amount exactly and
 * can go straight into a Decimal-backed API field.
 */

export const MONEY_MAX_DIGITS = 15;

/** Keeps digits only, drops leading zeros ("0012" -> "12") and caps the length. */
export function toDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits.slice(0, MONEY_MAX_DIGITS);
}

/** "1250000" -> "1.250.000"; empty stays empty. */
export function groupThousands(digits: string): string {
  if (digits === "") return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Display text for a stored digit string. */
export function formatMoneyInput(digits: string): string {
  return groupThousands(toDigits(digits));
}

/** Pure number for display maths only (e.g. comparing with a balance); persist the digit string. */
export function digitsToNumber(digits: string): number {
  return digits === "" ? 0 : Number(digits);
}

/**
 * Re-formats what the user typed and returns where the caret should land,
 * counted in digits so it survives the thousand separators being re-inserted.
 */
export function reformatWithCaret(raw: string, caret: number): { digits: string; display: string; caret: number } {
  const digitsBeforeCaret = toDigits(raw.slice(0, caret)).length;
  const digits = toDigits(raw);
  const display = groupThousands(digits);
  const target = Math.min(digitsBeforeCaret, digits.length);
  let seen = 0;
  let position = 0;
  while (position < display.length && seen < target) {
    if (display[position] !== ".") seen += 1;
    position += 1;
  }
  return { digits, display, caret: position };
}
