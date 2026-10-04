import { ActionButtons } from "@/components/ui/button-group";
// Adapted from the Astryx CLI table-filter template.
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Table,
  pixel,
  proportional,
  useTableGroupedRows,
  type TablePlugin,
} from "@astryxdesign/core/Table";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Icon } from "@astryxdesign/core/Icon";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuDivider,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@astryxdesign/core/DropdownMenu";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bookmark,
  BookmarkPlus,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";

type SortableValue = string | number | boolean | Date | null | undefined;
export type Column<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  sortValue?: (row: T) => SortableValue;
  width?: string;
  minWidth?: number;
  groupValue?: (row: T) => string;
  filterValue?: (row: T) => string;
};
export type TableFilter = {
  key: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  multiple?: boolean;
  onChange: (value: string) => void;
};
export type TableToolbar = {
  search: string;
  onSearch: (value: string) => void;
  searchLabel: string;
  placeholder: string;
  filters?: TableFilter[];
};
type DataTableProps<T> = {
  columns: Column<T>[];
  data: T[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  emptyState?: ReactNode;
  density?: "default" | "compact";
  verticalAlign?: "middle" | "top";
  onVisibleRowsChange?: (rows: T[]) => void;
  toolbar?: TableToolbar;
  defaultGroup?: string;
  defaultSort?: { key: string; direction: "asc" | "desc" };
  filterData?: T[];
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

type View = {
  hidden: string[];
  group: string;
  density: "compact" | "balanced" | "spacious";
  sortKey: string | null;
  sortDir: "asc" | "desc";
  filters: Record<string, string[]>;
};
type SavedView = {
  id: number;
  name: string;
  view: View;
  search: string;
  external: Record<string, string>;
};

function FilterChip({
  label,
  values,
  options,
  onChange,
  multiple = true,
}: {
  label: string;
  multiple?: boolean;
  values: string[];
  options: { value: string; label: string }[];
  onChange: (values: string[]) => void;
}) {
  const active = values.length > 0;
  const first = options.find((option) => option.value === values[0])?.label;
  return (
    <HStack gap={0} vAlign="center">
      <DropdownMenu
        button={{
          label: active
            ? `${first ?? values[0]}${values.length > 1 ? `, +${values.length - 1}` : ""}`
            : label,
          "aria-label": `Filter by ${label.toLowerCase()}`,
          variant: "secondary",
          size: "sm",
          className: active
            ? "!border !border-solid !border-control"
            : "!border !border-solid !border-control bg-transparent",
        }}
      >
        {!multiple ? (
          <DropdownMenuRadioGroup
            key="choices"
            label={label}
            value={values[0] ?? "all"}
            onChange={(value) => onChange(value === "all" ? [] : [value])}
          >
            <DropdownMenuRadioItem value="all" label="All" />
            {options.map((option) => (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                label={option.label}
              />
            ))}
          </DropdownMenuRadioGroup>
        ) : (
          options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              label={option.label}
              value={values.includes(option.value)}
              onChange={(checked) =>
                onChange(
                  checked
                    ? [...values, option.value]
                    : values.filter((value) => value !== option.value),
                )
              }
            />
          ))
        )}
      </DropdownMenu>
      {active && (
        <IconButton
          aria-label={`Clear ${label.toLowerCase()} filter`}
          title={`Clear ${label.toLowerCase()} filter`}
          onClick={() => onChange([])}
        >
          <X size={14} />
        </IconButton>
      )}
    </HStack>
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
  verticalAlign = "middle",
  onVisibleRowsChange,
  toolbar,
  defaultGroup = "",
  defaultSort,
  filterData = data,
}: DataTableProps<T>) {
  const [currentPage, setCurrentPage] = useState(1);
  const [view, setView] = useState<View>({
    hidden: [],
    group: defaultGroup,
    density: density === "compact" ? "compact" : "balanced",
    sortKey: defaultSort?.key ?? null,
    sortDir: defaultSort?.direction ?? "asc",
    filters: {},
  });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<SavedView[]>([]);
  const [saveName, setSaveName] = useState<string | null>(null);
  const nextViewId = useRef(1);
  const patchView = (patch: Partial<View>) => {
    setView((current) => ({ ...current, ...patch }));
    setCurrentPage(1);
  };
  const filterColumns = columns.filter((column) => column.filterValue);
  const groupColumn = columns.find(
    (column) => column.key === view.group && column.groupValue,
  );
  const filtered = data.filter((row) =>
    filterColumns.every(
      (column) =>
        !view.filters[column.key]?.length ||
        view.filters[column.key].includes(column.filterValue!(row)),
    ),
  );
  const ordered = sortTableData(
    filtered,
    columns.find((column) => column.key === view.sortKey),
    view.sortDir,
  );
  if (groupColumn && view.sortKey !== groupColumn.key)
    ordered.sort((a, b) =>
      groupColumn.groupValue!(a).localeCompare(groupColumn.groupValue!(b)),
    );
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.ceil(ordered.length / safePageSize);
  const page = Math.max(1, Math.min(currentPage, totalPages));
  useEffect(() => {
    if (page !== currentPage) setCurrentPage(page);
  }, [page, currentPage]);
  const start = (page - 1) * safePageSize;
  const rows = ordered
    .slice(start, start + safePageSize)
    .map((record) => ({ record }));
  const grouped = useTableGroupedRows({
    data: rows,
    groupBy: (row) => groupColumn?.groupValue?.(row.record) ?? "",
    collapsedGroups: collapsed,
    onToggleGroup: (key) =>
      setCollapsed((current) => {
        const next = new Set(current);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    getRowKey: (row) => getRowKey(row.record),
  });
  const visibleRows = rows
    .filter(
      (row) =>
        !groupColumn || !collapsed.has(groupColumn.groupValue!(row.record)),
    )
    .map((row) => row.record);
  const visibleKey = JSON.stringify(visibleRows.map(getRowKey));
  const visibleRef = useRef(visibleRows);
  visibleRef.current = visibleRows;
  useEffect(() => {
    onVisibleRowsChange?.(visibleRef.current);
  }, [visibleKey, onVisibleRowsChange]);
  const filterKey = JSON.stringify([
    toolbar?.search,
    toolbar?.filters?.map((filter) => filter.value),
    view.filters,
  ]);
  useEffect(() => {
    setCurrentPage(1);
  }, [filterKey]);

  const visibleColumns = columns.filter(
    (column) => !view.hidden.includes(column.key),
  );
  const adapter: TablePlugin<{ record: T }> = {
    transformHeaderCell: (props, column) => ({
      ...props,
      htmlProps: {
        ...props.htmlProps,
        "aria-sort":
          view.sortKey === column.key
            ? view.sortDir === "asc"
              ? "ascending"
              : "descending"
            : undefined,
      },
    }),
    transformBodyRow: (props, row) => {
      if (!onRowClick || !row.record) return props;
      return {
        ...props,
        htmlProps: {
          ...props.htmlProps,
          tabIndex: 0,
          className: "cursor-pointer",
          onClick: (event) => {
            if (
              (event.target as HTMLElement).closest(
                "button, input, a, [role=checkbox]",
              )
            )
              return;
            onRowClick(row.record);
          },
          onKeyDown: (event) => {
            if (
              event.target === event.currentTarget &&
              (event.key === "Enter" || event.key === " ")
            ) {
              event.preventDefault();
              onRowClick(row.record);
            }
          },
        },
      };
    },
  };
  function clearAll() {
    toolbar?.onSearch("");
    toolbar?.filters?.forEach((filter) => filter.onChange("all"));
    patchView({ filters: {} });
  }
  const hasFilters = Boolean(
    toolbar?.search ||
    toolbar?.filters?.some((filter) => filter.value !== "all") ||
    Object.values(view.filters).some((values) => values.length),
  );
  return (
    <VStack gap={0} className="app-table-frame min-w-0">
      <HStack gap={3} paddingBlock={4} vAlign="center" wrap="wrap">
        {toolbar && (
          <TextInput
            label={toolbar.searchLabel}
            isLabelHidden
            size="sm"
            placeholder={toolbar.placeholder}
            startIcon={Search}
            value={toolbar.search}
            onChange={toolbar.onSearch}
            hasClear
            className="w-full sm:w-48"
          />
        )}
        {toolbar?.filters?.map((filter) => (
          <FilterChip
            key={filter.key}
            label={filter.label}
            multiple={filter.multiple ?? false}
            values={filter.value === "all" ? [] : filter.value.split("|")}
            options={filter.options}
            onChange={(values) => filter.onChange(values.join("|") || "all")}
          />
        ))}
        {filterColumns.map((column) => (
          <FilterChip
            key={column.key}
            label={String(column.header)}
            values={view.filters[column.key] ?? []}
            options={[...new Set(filterData.map(column.filterValue!))]
              .sort()
              .map((value) => ({ value, label: value }))}
            onChange={(values) =>
              patchView({ filters: { ...view.filters, [column.key]: values } })
            }
          />
        ))}
        <Text type="supporting" color="secondary" role="status">
          {filtered.length} {filtered.length === 1 ? "result" : "results"}
        </Text>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            Clear all
          </Button>
        )}
        <HStack gap={2} vAlign="center" className="ml-auto">
          <DropdownMenu
            button={{ label: "View options", variant: "ghost", size: "sm" }}
          >
            <DropdownMenuRadioGroup
              label="Group by"
              value={view.group}
              onChange={(group) => {
                patchView({ group });
                setCollapsed(new Set());
              }}
            >
              <DropdownMenuRadioItem value="" label="No grouping" />
              {columns
                .filter((column) => column.groupValue)
                .map((column) => (
                  <DropdownMenuRadioItem
                    key={column.key}
                    value={column.key}
                    label={`Group by ${String(column.header)}`}
                  />
                ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuDivider />
            <DropdownMenuRadioGroup
              label="Row density"
              value={view.density}
              onChange={(value) =>
                patchView({ density: value as View["density"] })
              }
            >
              <DropdownMenuRadioItem value="compact" label="Compact rows" />
              <DropdownMenuRadioItem
                value="balanced"
                label="Comfortable rows"
              />
              <DropdownMenuRadioItem value="spacious" label="Spacious rows" />
            </DropdownMenuRadioGroup>
            <DropdownMenuDivider />
            {columns
              .filter(
                (column) => typeof column.header === "string" && column.header,
              )
              .map((column, index) => (
                <DropdownMenuCheckboxItem
                  key={column.key}
                  label={`Show ${column.header}`}
                  value={!view.hidden.includes(column.key)}
                  isDisabled={index === 0}
                  onChange={(checked) =>
                    patchView({
                      hidden: checked
                        ? view.hidden.filter((key) => key !== column.key)
                        : [...view.hidden, column.key],
                    })
                  }
                />
              ))}
          </DropdownMenu>
          <IconButton
            aria-label="Create saved view"
            title="Create saved view for this page session"
            onClick={() => setSaveName("")}
          >
            <BookmarkPlus size={18} />
          </IconButton>
          <DropdownMenu
            button={{
              label: "Saved views",
              tooltip: "Saved views for this page session",
              variant: "ghost",
              size: "sm",
              isIconOnly: true,
              icon: <Icon icon={Bookmark} size="sm" />,
            }}
          >
            {saved.length === 0 && (
              <DropdownMenuItem
                label="No saved views in this session"
                isDisabled
              />
            )}
            {saved.map((item) => (
              <DropdownMenuItem
                key={item.id}
                label={item.name}
                onClick={() => {
                  setView(item.view);
                  setCollapsed(new Set());
                  setCurrentPage(1);
                  toolbar?.onSearch(item.search);
                  toolbar?.filters?.forEach((filter) =>
                    filter.onChange(item.external[filter.key] ?? "all"),
                  );
                }}
              />
            ))}
            {saved.length > 0 && (
              <DropdownMenuItem
                label="Clear saved views"
                variant="destructive"
                onClick={() => setSaved([])}
              />
            )}
          </DropdownMenu>
        </HStack>
      </HStack>
      {saveName !== null && (
        <HStack gap={2} paddingBlockEnd={4} wrap="wrap">
          <TextInput
            label="Saved view name"
            isLabelHidden
            placeholder="Name this view"
            size="sm"
            value={saveName}
            onChange={setSaveName}
            hasAutoFocus
          />
          <ActionButtons label="Saved view actions" size="sm">
          <Button
            size="sm"
            disabled={!saveName.trim()}
            onClick={() => {
              setSaved((current) => [
                ...current,
                {
                  id: nextViewId.current++,
                  name: saveName.trim(),
                  view,
                  search: toolbar?.search ?? "",
                  external: Object.fromEntries(
                    toolbar?.filters?.map((filter) => [
                      filter.key,
                      filter.value,
                    ]) ?? [],
                  ),
                },
              ]);
              setSaveName(null);
            }}
          >
            Save view
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSaveName(null)}>
            Cancel
          </Button>
          </ActionButtons>
        </HStack>
      )}
      {filtered.length === 0 ? (
        (emptyState ?? <Text type="body">No matching results.</Text>)
      ) : (
        <Table<{ record: T }>
          data={groupColumn ? grouped.data : rows}
          idKey={groupColumn ? grouped.idKey : (row) => getRowKey(row.record)}
          density={view.density}
          dividers="rows"
          hasHover
          textOverflow="wrap"
          verticalAlign={verticalAlign}
          plugins={
            groupColumn ? { adapter, grouped: grouped.plugin } : { adapter }
          }
          columns={visibleColumns.map((column) => ({
            key: column.key,
            width: column.width?.endsWith("px")
              ? pixel(Number.parseFloat(column.width))
              : proportional(
                  column.width?.endsWith("%")
                    ? Number.parseFloat(column.width) / 10
                    : 2,
                  { minWidth: column.minWidth },
                ),
            header: column.sortable ? (
              <Button
                variant="ghost"
                size="sm"
                className="app-table-sort"
                onClick={() =>
                  patchView({
                    sortKey: column.key,
                    sortDir:
                      view.sortKey === column.key && view.sortDir === "asc"
                        ? "desc"
                        : "asc",
                  })
                }
              >
                {column.header}
                {view.sortKey === column.key ? (
                  view.sortDir === "asc" ? (
                    <ArrowUp size={14} />
                  ) : (
                    <ArrowDown size={14} />
                  )
                ) : (
                  <ArrowUpDown size={14} className="opacity-40" />
                )}
              </Button>
            ) : (
              column.header
            ),
            renderCell: (row) =>
              row.record ? column.render(row.record) : null,
          }))}
        />
      )}
      {totalPages > 1 && (
        <HStack gap={3} paddingBlock={4} hAlign="between" wrap="wrap">
          <Text type="supporting" color="secondary">
            Showing {start + 1}–
            {Math.min(start + safePageSize, filtered.length)} of{" "}
            {filtered.length}
          </Text>
          <HStack gap={2} vAlign="center">
            <Text type="supporting">
              Page {page} of {totalPages}
            </Text>
            <ActionButtons label="Pagination" size="sm">
            <Button
              variant="ghost"
              size="sm"
              disabled={page === 1}
              onClick={() => setCurrentPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={page === totalPages}
              onClick={() => setCurrentPage(page + 1)}
            >
              Next
            </Button>
            </ActionButtons>
          </HStack>
        </HStack>
      )}
    </VStack>
  );
}
