import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import { cn } from "@/lib/utils";

type ButtonProps = PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>> & {
  variant?: "primary" | "secondary";
};

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition",
        variant === "primary"
          ? "bg-ink text-white hover:bg-spruce"
          : "border border-ink/15 bg-white text-ink hover:border-spruce hover:text-spruce",
        props.disabled ? "cursor-not-allowed opacity-60" : "",
        className,
      )}
      {...props}
    />
  );
}
