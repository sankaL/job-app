import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import { IconButton as AstryxIconButton } from "@astryxdesign/core/IconButton";
import { cn } from "@/lib/utils";
import { useActionGroup } from "./button-group";

type IconButtonProps = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement>
> & {
  /** `danger` is a solid red button with a white icon, or a red icon in a plain group. */
  variant?: "default" | "danger";
  /** Icon colour inside a plain `ActionButtons` group; `danger` implies red. */
  tone?: "neutral" | "success";
};

export function IconButton({
  className,
  variant = "default",
  tone = "neutral",
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
        group?.plain
          ? "ghost"
          : variant === "danger"
          ? "destructive"
          : group?.isPrimary
            ? "primary"
            : group
              ? "secondary"
              : "ghost"
      }
      size={group?.size ?? "sm"}
      isDisabled={disabled}
      className={cn(
        group?.plain
          ? cn("app-icon-plain", variant === "danger" ? "app-icon-danger" : `app-icon-${tone}`)
          : variant === "danger" && "app-button-danger",
        className,
      )}
    />
  );
}
