import { forwardRef, useId, useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";

/** Keep the native input/ref so browser autofill and form submission work normally. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<ComponentProps<"input">, "type">>(
  ({ id, disabled, style, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const [visible, setVisible] = useState(false);
    return <div className="relative w-full">
      <input {...props} ref={ref} id={inputId} type={visible ? "text" : "password"} disabled={disabled}
        style={{ ...style, paddingInlineEnd: "2.75rem" }} />
      <button type="button" disabled={disabled} aria-controls={inputId} aria-pressed={visible}
        aria-label={visible ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-slate-500 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:opacity-50"
        onClick={() => setVisible(value => !value)}>
        {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>;
  }
);
PasswordInput.displayName = "PasswordInput";
