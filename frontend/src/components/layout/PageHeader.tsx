import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Theme } from "@astryxdesign/core/theme";
import { applixTheme } from "@/themes/applix";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

type PageHeaderProps = {
  title: string;
  titleContent?: ReactNode;
  titleAction?: ReactNode;
  subtitle?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  hasBodyHeading?: boolean;
};

export function PageHeader({
  title,
  titleContent,
  titleAction,
  subtitle,
  badge,
  actions,
  hasBodyHeading = false,
}: PageHeaderProps) {
  const floatingRef = useRef<HTMLElement>(null);
  const hasFloatingActions = Boolean(
    actions || (!hasBodyHeading && (titleContent || titleAction)),
  );

  useLayoutEffect(() => {
    const element = floatingRef.current;
    if (!element) return;
    const bodyStyle = document.body.style;
    const property = "--floating-page-actions-height";
    const previousHeight = bodyStyle.getPropertyValue(property);
    const measure = () =>
      bodyStyle.setProperty(
        property,
        `${Math.max(48, Math.ceil(element.getBoundingClientRect().height))}px`,
      );
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      if (previousHeight) bodyStyle.setProperty(property, previousHeight);
      else bodyStyle.removeProperty(property);
    };
  }, [hasFloatingActions]);

  return (
    <>
      {hasBodyHeading ? (
        <HStack
          gap={4}
          vAlign="start"
          hAlign="between"
          wrap="wrap"
          className="app-page-header relative z-20"
        >
          <VStack gap={1} className="min-w-0 flex-1">
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Heading level={1} className="min-w-0">
                {titleContent ?? title}
              </Heading>
              {titleAction}
              {badge}
            </HStack>
            {subtitle ? (
              <Text as="p" type="body" color="secondary">
                {subtitle}
              </Text>
            ) : null}
          </VStack>
        </HStack>
      ) : (
        <Heading level={1} className="sr-only app-page-heading-hidden">
          {title}
        </Heading>
      )}
      {hasFloatingActions && typeof document !== "undefined"
        ? createPortal(
            <Theme theme={applixTheme} mode="light">
              <VStack
                ref={floatingRef}
                gap={2}
                hAlign="end"
                className="app-floating-page-actions"
              >
                {!hasBodyHeading && titleContent ? (
                  <HStack className="app-floating-name-editor">
                    {titleContent}
                  </HStack>
                ) : null}
                {actions || (!hasBodyHeading && titleAction) ? (
                  <HStack
                    gap={2}
                    wrap="wrap"
                    hAlign="end"
                    role="group"
                    aria-label={`${title} actions`}
                    className="app-floating-action-buttons"
                  >
                    {!hasBodyHeading && titleAction}
                    {actions}
                  </HStack>
                ) : null}
              </VStack>
            </Theme>,
            document.body,
          )
        : null}
    </>
  );
}
