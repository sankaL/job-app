import {
  Children,
  isValidElement,
  type ButtonHTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
  type Ref,
} from "react";
import { Button as AstryxButton } from "@astryxdesign/core/Button";
import { cn } from "@/lib/utils";

type ButtonProps = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement>
> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  contentLayout?: "inline" | "block";
  ref?: Ref<HTMLButtonElement>;
};

function textLabel(children: ReactNode): string {
  return Children.toArray(children)
    .map((child): string => {
      if (typeof child === "string" || typeof child === "number")
        return String(child);
      if (isValidElement<{ children?: ReactNode }>(child))
        return textLabel(child.props.children);
      return "";
    })
    .join(" ")
    .trim();
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  loading,
  disabled,
  children,
  title,
  style,
  contentLayout = "inline",
  ...props
}: ButtonProps) {
  const geometry: Record<string, string> = { height: "auto" };
  for (const token of className?.split(/\s+/) ?? []) {
    const match = token.match(/^([wh])-(\d+)$/);
    if (match)
      geometry[match[1] === "w" ? "width" : "height"] =
        `${Number(match[2]) / 4}rem`;
    if (token === "w-full") geometry.width = "100%";
  }
  return (
    <AstryxButton
      {...props}
      label={props["aria-label"] ?? textLabel(children)}
      // Let complex visible children and aria-labelledby supply the accessible name.
      aria-label={props["aria-label"]}
      {...{ title }}
      variant={variant === "danger" ? "destructive" : variant}
      size={size}
      isLoading={loading}
      isDisabled={disabled}
      className={cn("app-button", className)}
      style={{ ...geometry, ...style }}
    >
      <span
        className={cn(
          "app-button-content",
          contentLayout === "block" && "app-button-content--block",
        )}
      >
        {children}
      </span>
    </AstryxButton>
  );
}
