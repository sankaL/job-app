import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  titleContent?: ReactNode;
  titleAction?: ReactNode;
  subtitle?: string;
  badge?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({
  title,
  titleContent,
  titleAction,
  subtitle,
  badge,
  actions,
}: PageHeaderProps) {
  return (
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
      {actions ? (
        <HStack
          gap={2}
          wrap="wrap"
          vAlign="center"
          className="app-page-actions"
        >
          {actions}
        </HStack>
      ) : null}
    </HStack>
  );
}
