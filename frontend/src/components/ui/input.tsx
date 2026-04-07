import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-base text-ink outline-none transition placeholder:text-ink/40 focus:border-spruce focus:ring-2 focus:ring-spruce/15",
        className,
      )}
      {...props}
    />
  );
}
