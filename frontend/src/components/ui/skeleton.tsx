import {
  Table as AstryxTable,
  TableRow as AstryxRow,
  TableCell as AstryxCell,
  TableHeaderCell as AstryxHeaderCell,
} from "@astryxdesign/core/Table";
import { cn } from "@/lib/utils";

type SkeletonProps = {
  className?: string;
};

type SkeletonCardProps = SkeletonProps & {
  density?: "default" | "compact";
};

export function SkeletonLine({ className }: SkeletonProps) {
  return <div className={cn("animate-skeleton h-3 rounded", className)} />;
}

function SkeletonBlock({ className }: SkeletonProps) {
  return <div className={cn("animate-skeleton h-10 rounded-lg", className)} />;
}

export function SkeletonCard({
  className,
  density = "default",
}: SkeletonCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border",
        density === "compact" ? "p-4" : "p-5",
        className,
      )}
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-background-card)",
      }}
    >
      <SkeletonLine className="w-24" />
      <SkeletonBlock className="mt-3 w-3/4" />
      <SkeletonLine className="mt-3 w-full" />
      <SkeletonLine className="mt-2 w-4/5" />
    </div>
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
      className="app-table-frame overflow-hidden rounded-xl border"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-background-card)",
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
