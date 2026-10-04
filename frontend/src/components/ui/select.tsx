import {
  Children,
  Fragment,
  forwardRef,
  isValidElement,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { HStack } from "@astryxdesign/core/HStack";
import {
  DropdownMenu,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuDivider,
} from "@astryxdesign/core/DropdownMenu";
import { cn } from "@/lib/utils";

type Option = {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
};
function optionText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? optionText(child.props.children)
        : String(child),
    )
    .join("");
}
function optionsFrom(
  children: ReactNode,
  group?: string,
  disabled = false,
): Option[] {
  return Children.toArray(children).flatMap((child): Option[] => {
    if (
      !isValidElement<{
        value?: string | number;
        children?: ReactNode;
        disabled?: boolean;
        label?: string;
      }>(child)
    )
      return [];
    if (child.type === Fragment)
      return optionsFrom(child.props.children, group, disabled);
    if (child.type === "optgroup")
      return optionsFrom(
        child.props.children,
        child.props.label,
        disabled || child.props.disabled,
      );
    if (child.type !== "option") return [];
    return [
      {
        value: String(child.props.value ?? child.props.children ?? ""),
        label: child.props.label ?? optionText(child.props.children),
        disabled: disabled || child.props.disabled,
        group,
      },
    ];
  });
}

// Astryx owns the popup and keyboard path; a native backing field preserves
// form validation, form data, selection refs and existing change-event consumers.
export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select(
  { className, children, value, defaultValue, onChange, style, id, ...props },
  ref,
) {
  const options = optionsFrom(children);
  const fieldRef = useRef<HTMLSelectElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [localValue, setLocalValue] = useState(
    String(defaultValue ?? options[0]?.value ?? ""),
  );
  useImperativeHandle(ref, () => fieldRef.current!);
  useEffect(() => {
    if (value !== undefined) return;
    const field = fieldRef.current;
    const form = field?.form;
    if (!field || !form) return;
    const reset = () =>
      queueMicrotask(() => {
        if (fieldRef.current === field) setLocalValue(field.value);
      });
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [value, props.form]);
  const selectedValue = String(value ?? localValue);
  const selected = options.find((option) => option.value === selectedValue);
  const label = props["aria-label"] ?? "Choose an option";
  return (
    <HStack className={cn("app-select-field", className)} style={style}>
      <DropdownMenu
        presentation="popover"
        button={{
          ref: triggerRef,
          id,
          label: selected?.label ?? options[0]?.label ?? label,
          variant: "secondary",
          width: "100%",
          isDisabled: props.disabled,
          "aria-label": props["aria-label"],
          "aria-labelledby": props["aria-labelledby"],
          "aria-describedby": props["aria-describedby"],
          "aria-invalid": props["aria-invalid"],
          className: "app-select-trigger",
          style: { justifyContent: "space-between" },
        }}
      >
        <DropdownMenuRadioGroup
          label={label}
          aria-labelledby={props["aria-labelledby"] ?? id}
          value={selectedValue}
          onChange={(nextValue) => {
            const field = fieldRef.current;
            if (!field) return;
            field.value = nextValue;
            field.dispatchEvent(new Event("change", { bubbles: true }));
          }}
        >
          {options.map((option, index) => (
            <Fragment key={option.value}>
              {index > 0 && option.group !== options[index - 1].group ? (
                <DropdownMenuDivider />
              ) : null}
              <DropdownMenuRadioItem
                value={option.value}
                label={option.label}
                isDisabled={option.disabled}
              />
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenu>
      <select
        {...props}
        id={id ? `${id}-native` : undefined}
        ref={fieldRef}
        className="app-select-native"
        aria-hidden="true"
        tabIndex={-1}
        value={value}
        defaultValue={defaultValue}
        onFocus={(event) => {
          triggerRef.current?.focus();
          props.onFocus?.(event);
        }}
        onChange={(event) => {
          setLocalValue(event.target.value);
          onChange?.(event);
        }}
      >
        {children}
      </select>
    </HStack>
  );
});
