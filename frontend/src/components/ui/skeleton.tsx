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

export function SkeletonBlock({ className }: SkeletonProps) {
  return <div className={cn("animate-skeleton h-10 rounded-lg", className)} />;
}

export function SkeletonCard({ className, density = "default" }: SkeletonCardProps) {
  return (
    <div
      className={cn("rounded-xl border", density === "compact" ? "p-4" : "p-5", className)}
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <SkeletonLine className="w-24" />
      <SkeletonBlock className="mt-3 w-3/4" />
      <SkeletonLine className="mt-3 w-full" />
      <SkeletonLine className="mt-2 w-4/5" />
    </div>
  );
}

export function SkeletonTableRow({ columns = 6 }: { columns?: number }) {
  return (
    <tr>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <SkeletonLine className={i === 0 ? "w-20" : i === 1 ? "w-40" : "w-24"} />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonTable({ rows = 5, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <table className="w-full">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i} className="px-4 py-3 text-left">
                <SkeletonLine className="w-16" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <SkeletonTableRow key={i} columns={columns} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
