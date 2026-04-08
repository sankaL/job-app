import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border bg-white px-4 py-3 text-sm outline-none transition",
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
}
