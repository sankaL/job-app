import type { LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Label({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("app-field-label mb-1.5 block", className)}
      style={{ color: "var(--color-text-secondary)" }}
      {...props}
    />
  );
}
