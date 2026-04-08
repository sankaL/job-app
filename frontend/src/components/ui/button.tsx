import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import { cn } from "@/lib/utils";

type ButtonProps = PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>> & {
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

const VARIANT_CLASSES: Record<string, string> = {
  primary: "bg-ink text-white hover:bg-spruce",
  secondary: "border bg-white text-ink hover:text-spruce",
  danger: "border text-ember hover:bg-ember/5",
};

const SIZE_CLASSES: Record<string, string> = {
  sm: "px-3 py-1.5 text-xs gap-1.5",
  md: "px-4 py-2 text-sm gap-2",
  lg: "px-5 py-2.5 text-sm gap-2",
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-semibold transition-all",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        isDisabled ? "cursor-not-allowed opacity-50" : "",
        className,
      )}
      style={{
        borderColor: variant !== "primary" ? "var(--color-border)" : undefined,
      }}
      disabled={isDisabled}
      {...props}
    >
      {loading && (
        <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="8" strokeLinecap="round" />
        </svg>
      )}
      {children}
    </button>
  );
}
