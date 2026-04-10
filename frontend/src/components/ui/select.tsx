import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "w-full appearance-none rounded-lg border bg-white px-3 py-2 pr-8 text-sm outline-none transition",
        "focus:ring-2",
        className,
      )}
      style={{
        borderColor: "var(--color-border)",
        color: "var(--color-ink)",
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 12 12' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%23666' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 10px center",
        // @ts-expect-error CSS custom properties
        "--tw-ring-color": "var(--color-spruce-10)",
      }}
      {...props}
    />
  );
}
