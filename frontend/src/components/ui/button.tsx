import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import { cn } from "@/lib/utils";

type ButtonProps = PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>> & {
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
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
        variant === "primary" && "text-white",
        variant === "secondary" && "border bg-white hover:bg-gray-50",
        variant === "danger" && "border hover:bg-red-50",
        size === "sm" && "px-3 py-1.5 text-xs gap-1.5",
        size === "md" && "px-4 py-2 text-sm gap-2",
        size === "lg" && "px-5 py-2.5 text-sm gap-2",
        isDisabled ? "cursor-not-allowed opacity-50" : "",
        className,
      )}
      style={{
        ...(variant === "primary"
          ? { background: "var(--color-ember-light)" }
          : variant === "secondary"
          ? { borderColor: "var(--color-border)", color: "var(--color-ink)" }
          : { borderColor: "var(--color-ember)", color: "var(--color-ember)" }),
      }}
      onMouseEnter={(e) => {
        if (variant === "primary" && !isDisabled) {
          (e.currentTarget as HTMLButtonElement).style.background = "var(--color-ember)";
        }
        if (variant === "secondary" && !isDisabled) {
          (e.currentTarget as HTMLButtonElement).style.color = "var(--color-spruce)";
        }
        props.onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        if (variant === "primary" && !isDisabled) {
          (e.currentTarget as HTMLButtonElement).style.background = "var(--color-ember-light)";
        }
        if (variant === "secondary" && !isDisabled) {
          (e.currentTarget as HTMLButtonElement).style.color = "var(--color-ink)";
        }
        props.onMouseLeave?.(e);
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
