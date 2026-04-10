import type { ReactNode } from "react";
import { useEffect, useState } from "react";

type SortableValue = string | number | boolean | Date | null | undefined;

type Column<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  sortValue?: (row: T) => SortableValue;
  width?: string;
};

type DataTableProps<T> = {
  columns: Column<T>[];
  data: T[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  emptyState?: ReactNode;
  density?: "default" | "compact";
  tableLayout?: "auto" | "fixed";
  verticalAlign?: "middle" | "top";
  onVisibleRowsChange?: (rows: T[]) => void;
};

export function DataTable<T>({
  columns,
  data,
  getRowKey,
  onRowClick,
  pageSize = 25,
  emptyState,
  density = "default",
  tableLayout = "auto",
  verticalAlign = "middle",
  onVisibleRowsChange,
}: DataTableProps<T>) {
  const [currentPage, setCurrentPage] = useState(1);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function getDateSortValue(value: Exclude<SortableValue, null | undefined>) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "string" || typeof value === "number") {
      return new Date(value).getTime();
    }
    return Number(value);
  }

  const sortedColumn = sortKey ? columns.find((column) => column.key === sortKey) : undefined;
  const sortedData =
    sortedColumn
      ? [...data].sort((left, right) => {
          const getValue = sortedColumn.sortValue ?? ((row: T) => (row as Record<string, SortableValue>)[sortedColumn.key]);
          const leftValue = getValue(left);
          const rightValue = getValue(right);
          const direction = sortDir === "asc" ? 1 : -1;

          if (leftValue == null && rightValue == null) return 0;
          if (leftValue == null) return 1;
          if (rightValue == null) return -1;

          if (leftValue instanceof Date || rightValue instanceof Date) {
            return (getDateSortValue(leftValue) - getDateSortValue(rightValue)) * direction;
          }

          if (typeof leftValue === "number" && typeof rightValue === "number") {
            return (leftValue - rightValue) * direction;
          }

          if (typeof leftValue === "boolean" && typeof rightValue === "boolean") {
            return (Number(leftValue) - Number(rightValue)) * direction;
          }

          return String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true }) * direction;
        })
      : data;
  const totalPages = Math.ceil(sortedData.length / pageSize);
  const safeCurrentPage = totalPages === 0 ? 1 : Math.min(currentPage, totalPages);
  const startIdx = (safeCurrentPage - 1) * pageSize;
  const pageData = sortedData.slice(startIdx, startIdx + pageSize);

  useEffect(() => {
    if (currentPage !== safeCurrentPage) {
      setCurrentPage(safeCurrentPage);
    }
  }, [currentPage, safeCurrentPage]);

  useEffect(() => {
    onVisibleRowsChange?.(pageData);
  }, [onVisibleRowsChange, pageData]);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className="animate-fadeIn">
      <div
        className="overflow-hidden rounded-xl border"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ color: "var(--color-ink)", tableLayout }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={
                      density === "compact"
                        ? "px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.18em]"
                        : "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                    }
                    style={{
                      color: "var(--color-ink-50)",
                      background: "var(--color-ink-05)",
                      width: col.width,
                      cursor: col.sortable ? "pointer" : "default",
                      userSelect: col.sortable ? "none" : "auto",
                    }}
                    onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  >
                    <span className="flex items-center gap-1.5">
                      {col.header}
                      {col.sortable && (
                        <span
                          style={{
                            display: "inline-flex",
                            flexDirection: "column",
                            gap: "1px",
                            opacity: sortKey === col.key ? 1 : 0.35,
                            transition: "opacity 150ms",
                          }}
                        >
                          {/* Up arrow */}
                          <svg
                            width="8"
                            height="5"
                            viewBox="0 0 8 5"
                            fill="currentColor"
                            style={{
                              opacity: sortKey === col.key && sortDir === "desc" ? 0.3 : 1,
                            }}
                          >
                            <path d="M4 0l4 5H0L4 0z" />
                          </svg>
                          {/* Down arrow */}
                          <svg
                            width="8"
                            height="5"
                            viewBox="0 0 8 5"
                            fill="currentColor"
                            style={{
                              opacity: sortKey === col.key && sortDir === "asc" ? 0.3 : 1,
                            }}
                          >
                            <path d="M4 5L0 0h8L4 5z" />
                          </svg>
                        </span>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageData.map((row) => (
                <tr
                  key={getRowKey(row)}
                  className="transition-colors"
                  style={{
                    borderBottom: "1px solid var(--color-border)",
                    cursor: onRowClick ? "pointer" : "default",
                  }}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--color-ink-05)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={
                        density === "compact"
                          ? `px-4 py-2.5 ${verticalAlign === "top" ? "align-top" : "align-middle"}`
                          : `px-4 py-3 ${verticalAlign === "top" ? "align-top" : "align-middle"}`
                      }
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs" style={{ color: "var(--color-ink-40)" }}>
            Showing {startIdx + 1}–{Math.min(startIdx + pageSize, data.length)} of {data.length}
          </div>
          <div className="flex items-center gap-1">
            <button
              disabled={safeCurrentPage === 1}
              onClick={() => setCurrentPage(safeCurrentPage - 1)}
              className="rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-ink-65)",
                background: "var(--color-white)",
              }}
            >
              Previous
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }).map((_, i) => {
              let page: number;
              if (totalPages <= 7) {
                page = i + 1;
              } else if (safeCurrentPage <= 4) {
                page = i + 1;
              } else if (safeCurrentPage >= totalPages - 3) {
                page = totalPages - 6 + i;
              } else {
                page = safeCurrentPage - 3 + i;
              }

              return (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className="rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
                  style={{
                    background: safeCurrentPage === page ? "var(--color-ink)" : "transparent",
                    color: safeCurrentPage === page ? "#fff" : "var(--color-ink-65)",
                  }}
                >
                  {page}
                </button>
              );
            })}
            <button
              disabled={safeCurrentPage === totalPages}
              onClick={() => setCurrentPage(safeCurrentPage + 1)}
              className="rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-ink-65)",
                background: "var(--color-white)",
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
