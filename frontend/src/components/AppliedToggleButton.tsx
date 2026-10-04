import { Check, CircleCheck } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
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
  if (compact)
    return (
      <IconButton
        {...props}
        aria-label={applied ? "Applied" : "Mark Applied"}
        aria-pressed={applied}
        title={
          applied ? "Applied. Click to mark as not applied" : "Mark as applied"
        }
        onClick={onClick}
        disabled={disabled}
        className={className}
      >
        {applied ? (
          <CircleCheck size={18} aria-hidden="true" />
        ) : (
          <Check size={18} aria-hidden="true" />
        )}
      </IconButton>
    );
  return (
    <Button
      variant={applied ? "primary" : "secondary"}
      aria-pressed={applied}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(className)}
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
