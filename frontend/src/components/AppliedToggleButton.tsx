import type { ButtonHTMLAttributes, MouseEvent } from "react";
import { cn } from "@/lib/utils";

type AppliedToggleButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  applied: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  compact?: boolean;
};

export function AppliedToggleButton({
  applied,
  onClick,
  className,
  compact = false,
  disabled,
  ...props
}: AppliedToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full border font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50",
        compact ? "h-8 min-w-[7.5rem] px-3 text-[11px]" : "h-9 min-w-[8.5rem] px-3.5 text-xs",
        className,
      )}
      style={{
        background: applied ? "var(--color-spruce)" : "var(--color-spruce-05)",
        color: applied ? "#fff" : "var(--color-spruce)",
        borderColor: applied ? "var(--color-spruce)" : "rgba(24, 74, 69, 0.18)",
      }}
      onMouseEnter={(event) => {
        if (!applied && !disabled) {
          event.currentTarget.style.background = "var(--color-spruce-10)";
          event.currentTarget.style.borderColor = "var(--color-spruce)";
        }
        props.onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        if (!applied && !disabled) {
          event.currentTarget.style.background = "var(--color-spruce-05)";
          event.currentTarget.style.borderColor = "rgba(24, 74, 69, 0.18)";
        }
        props.onMouseLeave?.(event);
      }}
      {...props}
    >
      {applied ? (
        <>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.5 6.5l2.5 2.5 4.5-5" />
          </svg>
          Applied
        </>
      ) : (
        "Mark Applied"
      )}
    </button>
  );
}
