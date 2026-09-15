import * as React from "react"
import { Eye, EyeOff } from "lucide-react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false)
    const generatedId = React.useId()
    const isPassword = type === "password"
    const inputId = props.id ?? (isPassword ? generatedId : undefined)
    const input = (
      <input
        type={isPassword && visible ? "text" : type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
        id={inputId}
        style={isPassword ? { ...props.style, paddingInlineEnd: "2.75rem" } : props.style}
      />
    )
    if (!isPassword) return input
    return (
      <div className="relative w-full">
        {input}
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={visible ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
          aria-controls={inputId}
          aria-pressed={visible}
          disabled={props.disabled}
          onClick={() => setVisible(value => !value)}
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    )
  }
)
Input.displayName = "Input"

export { Input }
