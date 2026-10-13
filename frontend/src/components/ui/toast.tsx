import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { StackItem } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import {
  ToastViewport,
  useToast as useAstryxToast,
  type ToastContentRenderProps,
} from "@astryxdesign/core/Toast";
import {
  useCallback,
  useMemo,
  type PropsWithChildren,
  type ReactNode,
} from "react";

/* ── Types ── */
/**
 * success/info: black card. error: red card that stays until dismissed.
 * destructive: a completed delete, deactivate or stop, shown on the red card
 * but announced politely and auto-hidden like any other success.
 */
export type ToastVariant = "success" | "info" | "error" | "destructive";

type ToastContextValue = {
  toast: (message: ReactNode, variant?: ToastVariant) => void;
};

/* ── Constants ── */
const AUTO_DISMISS_MS = 5000;
const MAX_VISIBLE = 4;

const variantIcons = {
  success: "success",
  info: "info",
  error: "error",
  destructive: "success",
} as const satisfies Record<ToastVariant, string>;

/*
 * Astryx Toast ships two surfaces: inverted (info) and error-inverted (error).
 * Destructive reuses the info card's status semantics and is recoloured red in
 * index.css through the data-app-toast-variant marker on this content.
 */
function renderToastContent(variant: ToastVariant) {
  return function ToastContent({ body, dismiss }: ToastContentRenderProps) {
    return (
      <HStack gap={3} vAlign="center" data-app-toast-variant={variant}>
        <Icon icon={variantIcons[variant]} size="sm" color="inherit" aria-hidden />
        <StackItem size="fill">
          <Text type="body" weight="medium" color="inherit" wordBreak="break-word">
            {body}
          </Text>
        </StackItem>
        <Button
          variant="ghost"
          size="sm"
          icon={<Icon icon="close" size="sm" color="inherit" />}
          label="Dismiss"
          onClick={dismiss}
          isIconOnly
        />
      </HStack>
    );
  };
}

/* ── Provider ── */
export function ToastProvider({ children }: PropsWithChildren) {
  return (
    <ToastViewport position="bottomEnd" maxVisible={MAX_VISIBLE}>
      {children}
    </ToastViewport>
  );
}

/* ── Hook ── */
export function useToast(): ToastContextValue {
  const showToast = useAstryxToast();

  const toast = useCallback(
    (message: ReactNode, variant: ToastVariant = "success") => {
      showToast({
        body: message,
        type: variant === "error" ? "error" : "info",
        autoHideDuration: AUTO_DISMISS_MS,
        renderContent: renderToastContent(variant),
      });
    },
    [showToast],
  );

  return useMemo(() => ({ toast }), [toast]);
}
