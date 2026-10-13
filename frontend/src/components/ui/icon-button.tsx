import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import { IconButton as AstryxIconButton } from "@astryxdesign/core/IconButton";
import { cn } from "@/lib/utils";
import { useActionGroup } from "./button-group";

type IconButtonProps = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement>
> & {
  /** `danger` is a solid red button with a white icon, inside or outside a group. */
  variant?: "default" | "danger";
};

export function IconButton({
  className,
  variant = "default",
  children,
  disabled,
  title,
  ...props
}: IconButtonProps) {
  const group = useActionGroup();
  return (
    <AstryxIconButton
      {...props}
      label={props["aria-label"] ?? title ?? "Action"}
      tooltip={disabled ? undefined : title}
      {...{ title }}
      icon={children}
      variant={
        variant === "danger"
          ? "destructive"
          : group?.isPrimary
            ? "primary"
            : group
              ? "secondary"
              : "ghost"
      }
      size={group?.size ?? "sm"}
      isDisabled={disabled}
      className={cn(variant === "danger" && "app-button-danger", className)}
    />
  );
}
