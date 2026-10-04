import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { ReactNode } from "react";
import { Section } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type CompositionDatum = {
  key: string;
  label: string;
  count: number;
  color: string;
};

export function formatShare(count: number, total: number) {
  return total > 0 ? `${Math.round((count / total) * 100)}%` : "0%";
}

export function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
      style={{ background: color }}
    />
  );
}

export function SectionTitle({
  title,
  caption,
}: {
  title: string;
  caption?: ReactNode;
}) {
  return (
    <HStack gap={3} hAlign="between" vAlign="center">
      <Heading level={3}>{title}</Heading>
      {typeof caption === "string" ? (
        <Text type="supporting" color="secondary">
          {caption}
        </Text>
      ) : (
        caption
      )}
    </HStack>
  );
}

// One horizontal stacked bar; segments are separated by a 2px surface gap, not strokes.
export function CompositionBar({
  ariaLabel,
  items,
  total,
}: {
  ariaLabel: string;
  items: CompositionDatum[];
  total: number;
}) {
  const visible = items.filter((item) => item.count > 0);
  const summary = describe(items, total);

  return (
    <div
      role="img"
      aria-label={`${ariaLabel}: ${summary}`}
      className={cn(
        "flex h-3 w-full gap-0.5 overflow-hidden rounded-sm",
        visible.length === 0 && "bg-[var(--color-background-muted)]",
      )}
    >
      {visible.map((item) => (
        <span
          key={item.key}
          title={`${item.label}: ${item.count} (${formatShare(item.count, total)})`}
          className="h-full min-w-1"
          style={{ flexGrow: item.count, background: item.color }}
        />
      ))}
    </div>
  );
}

function describe(items: CompositionDatum[], total: number) {
  const visible = items.filter((item) => item.count > 0);
  return visible.length
    ? visible
        .map(
          (item) =>
            `${item.label} ${item.count} (${formatShare(item.count, total)})`,
        )
        .join(", ")
    : "none";
}

const DONUT_SIZE = 112;
const DONUT_THICKNESS = 12;
const DONUT_GAP = 2;

// Thin ring for part-to-whole with a handful of categories; the total sits in the hole.
export function DonutChart({
  ariaLabel,
  items,
  total,
  centerCaption,
}: {
  ariaLabel: string;
  items: CompositionDatum[];
  total: number;
  centerCaption: string;
}) {
  const center = DONUT_SIZE / 2;
  const radius = (DONUT_SIZE - DONUT_THICKNESS) / 2;
  const circumference = 2 * Math.PI * radius;
  const visible = items.filter((item) => item.count > 0);
  const gap = visible.length > 1 ? DONUT_GAP : 0;
  let offset = 0;

  return (
    <svg
      role="img"
      aria-label={`${ariaLabel}: ${describe(items, total)}`}
      viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
      className="h-28 w-28 shrink-0"
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="var(--color-background-muted)"
        strokeWidth={DONUT_THICKNESS}
      />
      {visible.map((item) => {
        const length = (item.count / Math.max(total, 1)) * circumference;
        const dash = Math.max(length - gap, 0.5);
        const segment = (
          <circle
            key={item.key}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={item.color}
            strokeWidth={DONUT_THICKNESS}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${center} ${center})`}
          >
            <title>{`${item.label}: ${item.count} (${formatShare(item.count, total)})`}</title>
          </circle>
        );
        offset += length;
        return segment;
      })}
      <text
        x={center}
        y={center - 2}
        textAnchor="middle"
        className="fill-[var(--color-text-primary)] text-2xl font-semibold"
      >
        {total}
      </text>
      <text
        x={center}
        y={center + 16}
        textAnchor="middle"
        className="fill-[var(--color-text-secondary)] text-xs"
      >
        {centerCaption}
      </text>
    </svg>
  );
}

const PANEL_GROUP_LAYOUT = {
  2: "lg:grid-cols-2 lg:divide-x lg:divide-y-0",
  3: "xl:grid-cols-3 xl:divide-x xl:divide-y-0",
} as const;

const PANEL_LAYOUT = {
  2: "py-5 first:pt-0 last:pb-0 lg:px-6 lg:py-0 lg:first:pl-0 lg:last:pr-0",
  3: "py-5 first:pt-0 last:pb-0 xl:px-6 xl:py-0 xl:first:pl-0 xl:last:pr-0",
} as const;

// One flat section split by hairline rules: columns side by side when wide, stacked when narrow.
export function PanelGroup({
  columns,
  panels,
}: {
  columns: 2 | 3;
  panels: Array<{ key: string; title: string; content: ReactNode }>;
}) {
  return (
    <Section density="compact">
      <div
        className={cn(
          "grid divide-y divide-[var(--color-border)]",
          PANEL_GROUP_LAYOUT[columns],
        )}
      >
        {panels.map((panel) => (
          <VStack key={panel.key} gap={4} className={PANEL_LAYOUT[columns]}>
            <SectionTitle title={panel.title} />
            {panel.content}
          </VStack>
        ))}
      </div>
    </Section>
  );
}

export function CompositionChart({
  ariaLabel,
  items,
  total,
  centerCaption,
}: {
  ariaLabel: string;
  items: CompositionDatum[];
  total: number;
  centerCaption: string;
}) {
  return (
    <HStack gap={4} vAlign="center" wrap="wrap">
      <DonutChart
        ariaLabel={ariaLabel}
        items={items}
        total={total}
        centerCaption={centerCaption}
      />
      <VStack gap={3} className="min-w-40 max-w-sm flex-1">
        {items.map((item) => (
          <HStack
            key={item.key}
            gap={3}
            hAlign="between"
            vAlign="center"
            data-testid={`composition-row-${item.key}`}
          >
            <HStack gap={2} vAlign="center" className="min-w-0">
              <Swatch color={item.color} />
              <Text type="body" className="truncate">
                {item.label}
              </Text>
            </HStack>
            <HStack gap={3} vAlign="center" className="shrink-0">
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {formatShare(item.count, total)}
              </Text>
              <Text type="label" hasTabularNumbers className="w-6 text-right">
                {item.count}
              </Text>
            </HStack>
          </HStack>
        ))}
      </VStack>
    </HStack>
  );
}
