import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { createPortal } from "react-dom";
import { usePageActionHost } from "./ShellLayoutContext";
import type { ReactNode } from "react";
import { ActionButtons } from "@/components/ui/button-group";

type PageHeaderProps = {
  title: string;
  titleContent?: ReactNode;
  titleAction?: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  hasBodyHeading?: boolean;
  groupActions?: boolean;
  primaryActionIndex?: number;
};

export function PageHeader({
  title,
  titleContent,
  titleAction,
  subtitle,
  badge,
  actions,
  hasBodyHeading = false,
  groupActions = true,
  primaryActionIndex,
}: PageHeaderProps) {
  const actionHost = usePageActionHost();
  const actionContent = actions || (!hasBodyHeading && titleAction) ? (
        <HStack gap={2} wrap="wrap" hAlign="end" className="max-w-full">
          {groupActions ? (
            <ActionButtons label={`${title} actions`} primaryIndex={primaryActionIndex}>
              {!hasBodyHeading && titleAction}
              {actions}
            </ActionButtons>
          ) : <>{!hasBodyHeading && titleAction}{actions}</>}
        </HStack>
      ) : null;
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
              <Heading level={1} className={hasBodyHeading ? "min-w-0" : "sr-only"}>
                {titleContent ?? title}
              </Heading>
              {titleAction}
              {badge}
            </HStack>
            {subtitle ? (
              <HStack gap={2} className="text-secondary">{typeof subtitle === "string" ? <Text as="p" type="body" color="secondary">{subtitle}</Text> : subtitle}</HStack>
            ) : null}
          </VStack>
        </HStack>
      ) : <Heading level={1} className="sr-only app-page-heading-hidden">{title}</Heading>}
      {actionHost ? createPortal(actionContent, actionHost) : actionContent}
    </>
  );
}
