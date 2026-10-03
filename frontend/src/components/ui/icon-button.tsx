import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type IconButtonProps = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement>
> & {
  variant?: "default" | "danger";
};

export function IconButton({
  className,
  variant = "default",
  style,
  ...props
}: IconButtonProps) {
  return (
    <Button
      type="button"
      variant={variant === "danger" ? "danger" : "ghost"}
      className={cn("h-9 w-9 p-0", className)}
      style={{ width: "2.25rem", height: "2.25rem", padding: 0, ...style }}
      {...props}
    />
  );
}
