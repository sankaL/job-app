import { Button } from "@/components/ui/button";
import type { ButtonHTMLAttributes, MouseEvent } from "react";
import { cn } from "@/lib/utils";

type AppliedToggleButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick"
> & {
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
    <Button
      variant={applied ? "primary" : "secondary"}
      aria-pressed={applied}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full border font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50",
        compact
          ? "h-8 min-w-[7.5rem] px-3 text-xs"
          : "h-9 min-w-[8.5rem] px-3.5 text-xs",
        className,
      )}
      {...props}
    >
      {applied ? (
        <>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2.5 6.5l2.5 2.5 4.5-5" />
          </svg>
          Applied
        </>
      ) : (
        "Mark Applied"
      )}
    </Button>
  );
}
