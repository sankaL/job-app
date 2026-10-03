import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// Native selection preserves form validation, option groups and change-event consumers.
export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn("app-select w-full px-3 py-2 pr-8 text-sm", className)}
      {...props}
    />
  );
});
