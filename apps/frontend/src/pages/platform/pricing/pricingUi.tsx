import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PricingCatalog, PricingDraft, PricingLimits } from "@siskop/types";
import { apiFetch, ApiRequestError } from "@/api/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normaliseIdr } from "./pricingAdmin";

export const DRAFT_KEY = ["platform", "pricing", "draft"] as const;

/** The owner's working draft: one fetch feeds every tab. */
export function usePricingDraft() {
  return useQuery({ queryKey: DRAFT_KEY, queryFn: () => apiFetch<PricingDraft>("/platform/pricing/draft") });
}

/** Everything that depends on the draft or its history refetches after a write. */
export function useRefreshPricing() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["platform", "pricing"] });
}

export function errorMessage(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : "Terjadi kesalahan";
}

export function packageName(catalog: PricingCatalog, code: string): string {
  return catalog.packages.find((p) => p.code === code)?.name ?? code;
}

export const LIMIT_FIELDS: { key: keyof PricingLimits; label: string }[] = [
  { key: "members", label: "Anggota" },
  { key: "users", label: "Pengguna" },
  { key: "savingTypes", label: "Jenis simpanan" },
  { key: "loanTypes", label: "Jenis pinjaman" }
];

/** A rupiah amount typed by hand. Holds the raw text, reports the clean value (or null while invalid). */
export function MoneyInput({
  value,
  onChange,
  id,
  disabled,
  placeholder
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(value ?? "");
  const invalid = text.trim() !== "" && normaliseIdr(text) === null;
  return (
    <Input
      id={id}
      inputMode="decimal"
      disabled={disabled}
      placeholder={placeholder ?? "0"}
      value={text}
      aria-invalid={invalid}
      className={invalid ? "border-destructive" : undefined}
      onChange={(e) => {
        setText(e.target.value);
        onChange(normaliseIdr(e.target.value));
      }}
    />
  );
}

/** A count limit where an empty box plus the checkbox means unlimited (null). */
export function LimitInput({
  label,
  value,
  onChange,
  disabled
}: {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
  disabled?: boolean;
}) {
  const id = `limit-${label}`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={0}
        disabled={disabled || value === null}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Math.max(0, Math.floor(Number(e.target.value))))}
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox checked={value === null} disabled={disabled} onCheckedChange={(c) => onChange(c === true ? null : 0)} />
        Tanpa batas
      </label>
    </div>
  );
}
