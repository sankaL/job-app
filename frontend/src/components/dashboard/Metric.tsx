import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { Section } from "@/components/ui/card";

type MetricProps = {
  icon: LucideIcon;
  label: string;
  value: string | number;
  accent: string;
  detail?: ReactNode;
};

export function Metric({
  icon: Icon,
  label,
  value,
  accent,
  detail,
}: MetricProps) {
  return (
    <Section density="compact">
      <VStack gap={2}>
        <HStack gap={2} vAlign="center">
          <Icon
            size={16}
            aria-hidden="true"
            className="text-[var(--color-text-secondary)]"
          />
          <Text type="body" color="secondary">
            {label}
          </Text>
        </HStack>
        <Text type="display-3" hasTabularNumbers style={{ color: accent }}>
          {value}
        </Text>
        {detail}
      </VStack>
    </Section>
  );
}
