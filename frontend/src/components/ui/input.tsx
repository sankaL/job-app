import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none transition",
        "placeholder:text-[var(--color-ink-40)]",
        "focus:ring-2",
        className,
      )}
      style={{
        borderColor: "var(--color-border)",
        color: "var(--color-ink)",
        // @ts-expect-error CSS custom properties
        "--tw-ring-color": "var(--color-spruce-10)",
      }}
      {...props}
    />
  );
});
