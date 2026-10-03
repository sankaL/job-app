import { Badge as AstryxBadge } from "@astryxdesign/core/Badge";

type BadgeProps = {
  count: number;
  variant?: "default" | "warning" | "success";
  className?: string;
};
export function Badge({ count, variant = "default", className }: BadgeProps) {
  if (count <= 0) return null;
  return (
    <AstryxBadge
      label={count > 99 ? "99+" : count}
      variant={variant === "default" ? "neutral" : variant}
      className={className}
    />
  );
}
