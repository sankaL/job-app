import {
  Table as AstryxTable,
  TableRow as AstryxRow,
  TableCell as AstryxCell,
  TableHeaderCell as AstryxHeaderCell,
} from "@astryxdesign/core/Table";
import { Section } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SkeletonProps = {
  className?: string;
};

type SkeletonSectionProps = SkeletonProps & {
  density?: "default" | "compact";
};

export function SkeletonLine({ className }: SkeletonProps) {
  return <div className={cn("animate-skeleton h-3 rounded", className)} />;
}

function SkeletonBlock({ className }: SkeletonProps) {
  return <div className={cn("animate-skeleton h-10 rounded-lg", className)} />;
}

export function SkeletonSection({
  className,
  density = "default",
}: SkeletonSectionProps) {
  return (
    <Section density={density} className={className}>
      <SkeletonLine className="w-24" />
      <SkeletonBlock className="mt-3 w-3/4" />
      <SkeletonLine className="mt-3 w-full" />
      <SkeletonLine className="mt-2 w-4/5" />
    </Section>
  );
}

function SkeletonTableRow({ columns = 6 }: { columns?: number }) {
  return (
    <AstryxRow>
      {Array.from({ length: columns }).map((_, i) => (
        <AstryxCell key={i} className="px-4 py-3">
          <SkeletonLine
            className={i === 0 ? "w-20" : i === 1 ? "w-40" : "w-24"}
          />
        </AstryxCell>
      ))}
    </AstryxRow>
  );
}

export function SkeletonTable({
  rows = 5,
  columns = 6,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div
      className="app-table-frame overflow-hidden border-y"
      style={{
        borderColor: "var(--color-border)",
        background: "transparent",
      }}
    >
      <AstryxTable hasHover dividers="rows" className="w-full">
        <thead>
          <AstryxRow style={{ borderBottom: "1px solid var(--color-border)" }}>
            {Array.from({ length: columns }).map((_, i) => (
              <AstryxHeaderCell key={i} className="px-4 py-3 text-left">
                <SkeletonLine className="w-16" />
              </AstryxHeaderCell>
            ))}
          </AstryxRow>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <SkeletonTableRow key={i} columns={columns} />
          ))}
        </tbody>
      </AstryxTable>
    </div>
  );
}
