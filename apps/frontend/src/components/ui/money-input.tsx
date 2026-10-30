import * as React from "react"
import { AlertCircle } from "lucide-react"

import { cn } from "@/lib/utils"
import { formatMoneyInput, groupThousands, reformatWithCaret, toDigits } from "@/lib/money-input"

export interface MoneyInputProps {
  /** Digits only ("1250000"); an empty string means nothing typed yet. */
  value: string
  onValueChange: (digits: string) => void
  id?: string
  disabled?: boolean
  /** Inline validation message, shown with an icon (never colour alone). */
  error?: string
  /** Helper text under the field when there is no error. */
  hint?: string
  /** Quick amounts rendered as chips below the field; picking one sets the value. */
  quickAmounts?: readonly number[]
  "aria-label"?: string
  "aria-labelledby"?: string
  className?: string
}

/** Rupiah field: "Rp" prefix, thousands grouped as you type, 28px right-aligned tabular figures. */
const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onValueChange, id, disabled, error, hint, quickAmounts, className, ...aria }, ref) => {
    const generated = React.useId()
    const inputId = id ?? generated
    const messageId = `${inputId}-msg`
    const innerRef = React.useRef<HTMLInputElement | null>(null)
    const pendingCaret = React.useRef<number | null>(null)

    const setRefs = (node: HTMLInputElement | null) => {
      innerRef.current = node
      if (typeof ref === "function") ref(node)
      else if (ref) ref.current = node
    }

    React.useLayoutEffect(() => {
      if (pendingCaret.current !== null && innerRef.current && document.activeElement === innerRef.current) {
        innerRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current)
      }
      pendingCaret.current = null
    })

    const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const el = event.target
      const next = reformatWithCaret(el.value, el.selectionStart ?? el.value.length)
      pendingCaret.current = next.caret
      onValueChange(next.digits)
    }

    return (
      <div className={cn("space-y-2", className)}>
        <div
          className={cn(
            "flex h-[62px] items-center gap-2.5 rounded-[12px] border bg-card px-4 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1",
            error ? "border-destructive" : "border-input",
            disabled && "opacity-45"
          )}
        >
          <span aria-hidden="true" className="text-lg font-bold text-muted-foreground">
            Rp
          </span>
          <input
            ref={setRefs}
            id={inputId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            disabled={disabled}
            value={formatMoneyInput(value)}
            onChange={onChange}
            placeholder="0"
            aria-invalid={error ? true : undefined}
            aria-describedby={error || hint ? messageId : undefined}
            className="w-full min-w-0 border-0 bg-transparent text-right text-[28px] font-extrabold tabular-nums outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed"
            {...aria}
          />
        </div>
        {quickAmounts && quickAmounts.length > 0 ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Nominal cepat">
            {quickAmounts.map((amount) => {
              const digits = toDigits(String(amount))
              return (
                <button
                  key={amount}
                  type="button"
                  disabled={disabled}
                  onClick={() => onValueChange(digits)}
                  aria-pressed={value === digits}
                  className="inline-flex h-8 items-center rounded-full border border-input bg-card px-3.5 text-[13px] font-semibold tabular-nums transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45 aria-pressed:border-transparent aria-pressed:bg-primary aria-pressed:text-primary-foreground max-sm:h-11"
                >
                  {groupThousands(digits)}
                </button>
              )
            })}
          </div>
        ) : null}
        {error ? (
          <p id={messageId} role="alert" className="flex items-center gap-1.5 text-[12.5px] font-semibold text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : hint ? (
          <p id={messageId} className="text-[12.5px] text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    )
  }
)
MoneyInput.displayName = "MoneyInput"

export { MoneyInput }
