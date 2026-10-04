import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// Keep native validation, file/number/url types and ref contracts used by the workbench.
export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, type, ...props }, ref) {
  return (
    <input
      type={type}
      ref={ref}
      className={cn(
        type === "checkbox" || type === "radio"
          ? "app-check"
          : type === "file"
            ? "app-file"
            : "app-input w-full px-3 py-2 text-sm",
        className,
      )}
      {...props}
    />
  );
});
