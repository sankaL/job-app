import { cn } from "@/lib/utils";

type BadgeProps = {
  count: number;
  variant?: "default" | "warning" | "success";
  className?: string;
};

const VARIANT_STYLES = {
  default: { background: "var(--color-ink-10)", color: "var(--color-ink-65)" },
  warning: { background: "var(--color-ember)", color: "#fff" },
  success: { background: "var(--color-spruce)", color: "#fff" },
};

export function Badge({ count, variant = "default", className }: BadgeProps) {
  if (count <= 0) return null;

  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none",
        className,
      )}
      style={VARIANT_STYLES[variant]}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
