import type { ReactNode } from "react";
import { useEffect, useState } from "react";

type SortableValue = string | number | boolean | Date | null | undefined;

export type Column<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  sortValue?: (row: T) => SortableValue;
  width?: string;
  hiddenOnMobile?: boolean;
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

function getDateSortValue(value: Exclude<SortableValue, null | undefined>) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number")
    return new Date(value).getTime();
  return Number(value);
}

function compareNullish(
  left: SortableValue,
  right: SortableValue,
): number | null {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return null;
}

function compareSortableValues(left: SortableValue, right: SortableValue) {
  const nullishOrder = compareNullish(left, right);
  if (nullishOrder !== null) return nullishOrder;
  const definedLeft = left as Exclude<SortableValue, null | undefined>;
  const definedRight = right as Exclude<SortableValue, null | undefined>;
  if (definedLeft instanceof Date || definedRight instanceof Date)
    return getDateSortValue(definedLeft) - getDateSortValue(definedRight);
  if (typeof definedLeft === "number" && typeof definedRight === "number")
    return definedLeft - definedRight;
  if (typeof definedLeft === "boolean" && typeof definedRight === "boolean")
    return Number(definedLeft) - Number(definedRight);
  return String(definedLeft).localeCompare(String(definedRight), undefined, {
    numeric: true,
  });
}

function sortTableData<T>(
  data: T[],
  column: Column<T> | undefined,
  direction: "asc" | "desc",
) {
  if (!column) return data;
  const getValue =
    column.sortValue ??
    ((row: T) => (row as Record<string, SortableValue>)[column.key]);
  const multiplier = direction === "asc" ? 1 : -1;
  return [...data].sort((left, right) => {
    const leftValue = getValue(left);
    const rightValue = getValue(right);
    const nullishOrder = compareNullish(leftValue, rightValue);
    return (
      nullishOrder ?? compareSortableValues(leftValue, rightValue) * multiplier
    );
  });
}

function SortIndicator({
  active,
  direction,
}: {
  active: boolean;
  direction: "asc" | "desc";
}) {
  return (
    <span
      className="inline-flex flex-col gap-px transition-opacity"
      style={{ opacity: active ? 1 : 0.35 }}
    >
      <svg
        width="8"
        height="5"
        viewBox="0 0 8 5"
        fill="currentColor"
        style={{ opacity: active && direction === "desc" ? 0.3 : 1 }}
      >
        <path d="M4 0l4 5H0L4 0z" />
      </svg>
      <svg
        width="8"
        height="5"
        viewBox="0 0 8 5"
        fill="currentColor"
        style={{ opacity: active && direction === "asc" ? 0.3 : 1 }}
      >
        <path d="M4 5L0 0h8L4 5z" />
      </svg>
    </span>
  );
}

function TableHeader<T>({
  columns,
  density,
  sortKey,
  sortDir,
  onSort,
}: {
  columns: Column<T>[];
  density: "default" | "compact";
  sortKey: string | null;
  sortDir: "asc" | "desc";
  onSort: (key: string) => void;
}) {
  return (
    <thead>
      <tr className="border-b border-[var(--color-border)]">
        {columns.map((column) => {
          const active = sortKey === column.key;
          const className = `${density === "compact" ? "px-4 py-2.5 text-[11px] tracking-[0.18em]" : "px-4 py-3 text-xs tracking-wider"} text-left font-semibold uppercase${column.hiddenOnMobile ? " dt-hide-mobile" : ""}`;
          return (
            <th
              key={column.key}
              className={className}
              style={{
                color: "var(--color-ink-50)",
                background: "var(--color-ink-05)",
                width: column.width,
                cursor: column.sortable ? "pointer" : "default",
                userSelect: column.sortable ? "none" : "auto",
              }}
              onClick={column.sortable ? () => onSort(column.key) : undefined}
            >
              <span className="flex items-center gap-1.5">
                {column.header}
                {column.sortable ? (
                  <SortIndicator active={active} direction={sortDir} />
                ) : null}
              </span>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

function TableBody<T>({
  rows,
  columns,
  getRowKey,
  density,
  verticalAlign,
  onRowClick,
}: {
  rows: T[];
  columns: Column<T>[];
  getRowKey: (row: T) => string;
  density: "default" | "compact";
  verticalAlign: "middle" | "top";
  onRowClick?: (row: T) => void;
}) {
  const cellPadding = density === "compact" ? "px-4 py-2.5" : "px-4 py-3";
  const alignment = verticalAlign === "top" ? "align-top" : "align-middle";
  return (
    <tbody>
      {rows.map((row) => (
        <tr
          key={getRowKey(row)}
          className="border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-ink-05)]"
          style={{ cursor: onRowClick ? "pointer" : "default" }}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
        >
          {columns.map((column) => (
            <td
              key={column.key}
              className={`${cellPadding} ${alignment}${column.hiddenOnMobile ? " dt-hide-mobile" : ""}`}
            >
              {column.render(row)}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

function getPageNumbers(totalPages: number, currentPage: number) {
  const count = Math.min(totalPages, 7);
  const start =
    totalPages <= 7 || currentPage <= 4
      ? 1
      : currentPage >= totalPages - 3
        ? totalPages - 6
        : currentPage - 3;
  return Array.from({ length: count }, (_, index) => start + index);
}

function Pagination({
  totalPages,
  currentPage,
  startIndex,
  pageSize,
  totalItems,
  onChange,
}: {
  totalPages: number;
  currentPage: number;
  startIndex: number;
  pageSize: number;
  totalItems: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between">
      <div className="text-xs text-[var(--color-ink-40)]">
        Showing {startIndex + 1}–{Math.min(startIndex + pageSize, totalItems)}{" "}
        of {totalItems}
      </div>
      <div className="flex items-center gap-1">
        <button
          disabled={currentPage === 1}
          onClick={() => onChange(currentPage - 1)}
          className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--color-ink-65)] transition-colors disabled:opacity-40"
        >
          Previous
        </button>
        {getPageNumbers(totalPages, currentPage).map((page) => (
          <button
            key={page}
            onClick={() => onChange(page)}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
            style={{
              background:
                currentPage === page ? "var(--color-ink)" : "transparent",
              color: currentPage === page ? "#fff" : "var(--color-ink-65)",
            }}
          >
            {page}
          </button>
        ))}
        <button
          disabled={currentPage === totalPages}
          onClick={() => onChange(currentPage + 1)}
          className="rounded-md border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--color-ink-65)] transition-colors disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

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

  const sortedColumn = sortKey
    ? columns.find((column) => column.key === sortKey)
    : undefined;
  const sortedData = sortTableData(data, sortedColumn, sortDir);
  const totalPages = Math.ceil(sortedData.length / pageSize);
  const safeCurrentPage =
    totalPages === 0 ? 1 : Math.min(currentPage, totalPages);
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
        style={{
          borderColor: "var(--color-border)",
          background: "var(--color-surface)",
        }}
      >
        <div className="overflow-x-auto">
          <table
            className="w-full text-sm"
            style={{ color: "var(--color-ink)", tableLayout }}
          >
            <TableHeader
              columns={columns}
              density={density}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
            />
            <TableBody
              rows={pageData}
              columns={columns}
              getRowKey={getRowKey}
              density={density}
              verticalAlign={verticalAlign}
              onRowClick={onRowClick}
            />
          </table>
        </div>
      </div>

      <Pagination
        totalPages={totalPages}
        currentPage={safeCurrentPage}
        startIndex={startIdx}
        pageSize={pageSize}
        totalItems={data.length}
        onChange={setCurrentPage}
      />
    </div>
  );
}
