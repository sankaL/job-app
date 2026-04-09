import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import { cn } from "@/lib/utils";

type IconButtonProps = PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>> & {
  variant?: "default" | "danger";
};

export function IconButton({
  className,
  variant = "default",
  disabled,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg transition-all disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      style={{
        color: variant === "danger" ? "var(--color-ember)" : "var(--color-ink-50)",
        background: "transparent",
      }}
      onMouseEnter={(event) => {
        if (!disabled) {
          event.currentTarget.style.background =
            variant === "danger" ? "rgba(179, 56, 44, 0.08)" : "var(--color-ink-05)";
        }
        props.onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        if (!disabled) {
          event.currentTarget.style.background = "transparent";
        }
        props.onMouseLeave?.(event);
      }}
      {...props}
    >
      {children}
    </button>
  );
}
