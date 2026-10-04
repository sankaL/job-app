import { Children, Fragment, cloneElement, createContext, isValidElement, useContext, type ReactNode } from "react";
import { ButtonGroup } from "@astryxdesign/core/ButtonGroup";

const ActionGroupContext = createContext<{ size: "sm" | "md" | "lg"; isPrimary: boolean } | null>(null);
export const useActionGroup = () => useContext(ActionGroupContext);

function actionsIn(children: ReactNode, prefix = ""): ReactNode[] {
  return Children.toArray(children).flatMap((child, index) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? actionsIn(child.props.children, `${prefix}${index}.`)
      : [isValidElement(child) ? cloneElement(child, { key: `${prefix}${child.key ?? index}` }) : child],
  );
}

/** Related actions share a connected Astryx surface; a lone action stays a Button. */
export function ActionButtons({ children, label, size = "md", primaryIndex }: {
  children: ReactNode;
  label: string;
  size?: "sm" | "md" | "lg";
  /** Index among visible actions; defaults to the final action, usually Save/Continue. */
  primaryIndex?: number;
}) {
  const actions = actionsIn(children);
  if (actions.length < 2) return <>{actions}</>;
  const primary = Math.max(0, Math.min(primaryIndex ?? actions.length - 1, actions.length - 1));
  return (
    <ButtonGroup label={label} size={size}>
      {actions.map((action, index) => (
        <ActionGroupContext.Provider key={isValidElement(action) ? action.key : index} value={{ size, isPrimary: index === primary }}>
          {action}
        </ActionGroupContext.Provider>
      ))}
    </ButtonGroup>
  );
}
