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
        style={{ ...style, paddingInlineEnd: "3rem" }} />
      <button type="button" disabled={disabled} aria-controls={inputId} aria-pressed={visible}
        aria-label={visible ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45"
        onClick={() => setVisible(value => !value)}>
        {visible ? <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" /> : <Eye className="h-[18px] w-[18px]" aria-hidden="true" />}
      </button>
    </div>;
  }
);
PasswordInput.displayName = "PasswordInput";
