import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DataTable } from "@/components/ui/data-table";

type Row = {
  id: string;
  label: string;
  updated: number;
};

function getBodyRows() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.textContent ?? "");
}

function FilterableTable() {
  const [query, setQuery] = useState("");
  const rows: Row[] = Array.from({ length: 26 }, (_, index) => ({
    id: `row-${index + 1}`,
    label: index === 25 ? "Target role" : `Role ${index + 1}`,
    updated: index + 1,
  }));
  const filteredRows = rows.filter((row) =>
    row.label.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <>
      <input
        aria-label="Filter rows"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <DataTable
        columns={[
          {
            key: "label",
            header: "Label",
            render: (row: Row) => row.label,
          },
          {
            key: "updated",
            header: "Updated",
            sortable: true,
            sortValue: (row: Row) => row.updated,
            render: (row: Row) => row.updated,
          },
        ]}
        data={filteredRows}
        getRowKey={(row) => row.id}
        pageSize={25}
      />
    </>
  );
}

describe("data table", () => {
  it("clamps the current page when filtering shrinks the result set", async () => {
    const user = userEvent.setup();

    render(<FilterableTable />);

    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText("Target role")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/filter rows/i), "target");

    expect(screen.getByText("Target role")).toBeInTheDocument();
    expect(screen.queryByText("Role 1")).not.toBeInTheDocument();
  });

  it("reorders rows when a sortable header is clicked", async () => {
    const user = userEvent.setup();

    render(
      <DataTable
        columns={[
          {
            key: "label",
            header: "Label",
            render: (row: Row) => row.label,
          },
          {
            key: "updated",
            header: "Updated",
            sortable: true,
            sortValue: (row: Row) => row.updated,
            render: (row: Row) => row.updated,
          },
        ]}
        data={[
          { id: "newest", label: "Newest", updated: 30 },
          { id: "oldest", label: "Oldest", updated: 10 },
          { id: "middle", label: "Middle", updated: 20 },
        ]}
        getRowKey={(row) => row.id}
      />,
    );

    expect(getBodyRows()).toEqual(["Newest30", "Oldest10", "Middle20"]);

    await user.click(screen.getByText("Updated"));
    expect(getBodyRows()).toEqual(["Oldest10", "Middle20", "Newest30"]);

    await user.click(screen.getByText("Updated"));
    expect(getBodyRows()).toEqual(["Newest30", "Middle20", "Oldest10"]);
  });

  it("keeps missing sort values last in both directions", async () => {
    const user = userEvent.setup();
    const rows: Array<Omit<Row, "updated"> & { updated?: number | null }> = [
      { id: "missing", label: "Missing", updated: null },
      { id: "newest", label: "Newest", updated: 30 },
      { id: "oldest", label: "Oldest", updated: 10 },
    ];

    render(
      <DataTable
        columns={[
          {
            key: "label",
            header: "Label",
            render: (row) => row.label,
          },
          {
            key: "updated",
            header: "Updated",
            sortable: true,
            sortValue: (row) => row.updated,
            render: (row) => row.updated ?? "None",
          },
        ]}
        data={rows}
        getRowKey={(row) => row.id}
      />,
    );

    await user.click(screen.getByText("Updated"));
    expect(getBodyRows()).toEqual(["Oldest10", "Newest30", "MissingNone"]);

    await user.click(screen.getByText("Updated"));
    expect(getBodyRows()).toEqual(["Newest30", "Oldest10", "MissingNone"]);
  });

  it("reports the current page rows when pagination changes", async () => {
    const user = userEvent.setup();
    const handleVisibleRowsChange = vi.fn();

    render(
      <DataTable
        columns={[
          {
            key: "label",
            header: "Label",
            render: (row: Row) => row.label,
          },
        ]}
        data={Array.from({ length: 26 }, (_, index) => ({
          id: `row-${index + 1}`,
          label: `Role ${index + 1}`,
          updated: index + 1,
        }))}
        getRowKey={(row) => row.id}
        pageSize={25}
        onVisibleRowsChange={handleVisibleRowsChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(handleVisibleRowsChange).toHaveBeenCalled();
    expect(handleVisibleRowsChange.mock.lastCall?.[0]).toEqual([
      { id: "row-26", label: "Role 26", updated: 26 },
    ]);
  });
});

function TemplateTable({
  onVisibleRowsChange,
}: {
  onVisibleRowsChange?: (rows: Array<Row & { company: string }>) => void;
}) {
  const [search, setSearch] = useState("");
  const rows = [
    { id: "a", label: "Alpha", company: "Acme", updated: 3 },
    { id: "b", label: "Beta", company: "Acme", updated: 1 },
    { id: "c", label: "Gamma", company: "Other", updated: 2 },
  ];
  return (
    <DataTable
      data={rows.filter((row) =>
        row.label.toLowerCase().includes(search.toLowerCase()),
      )}
      filterData={rows}
      defaultGroup="company"
      getRowKey={(row) => row.id}
      onVisibleRowsChange={onVisibleRowsChange}
      toolbar={{
        search,
        onSearch: setSearch,
        searchLabel: "Search records",
        placeholder: "Search",
      }}
      columns={[
        {
          key: "label",
          header: "Label",
          render: (row) => row.label,
          sortable: true,
        },
        {
          key: "company",
          header: "Company",
          render: (row) => row.company,
          groupValue: (row) => row.company,
          filterValue: (row) => row.company,
        },
        {
          key: "updated",
          header: "Updated",
          render: (row) => row.updated,
          sortable: true,
        },
      ]}
    />
  );
}

describe("Astryx table-filter behavior", () => {
  it("sorts groups in the requested direction using the grouped column's custom order", async () => {
    const user = userEvent.setup();
    const statusOrder = ["Draft", "Needs Action", "Complete"];
    render(
      <DataTable
        data={[
          { id: "complete", status: "Complete" },
          { id: "needs-action", status: "Needs Action" },
          { id: "draft", status: "Draft" },
        ]}
        defaultGroup="status"
        getRowKey={(row) => row.id}
        columns={[
          {
            key: "status",
            header: "Status",
            render: (row) => row.status,
            sortable: true,
            sortValue: (row) => statusOrder.indexOf(row.status),
            groupValue: (row) => row.status,
          },
        ]}
      />,
    );
    const groupOrder = () =>
      screen
        .getAllByRole("button", { name: /^Collapse group / })
        .map((button) =>
          button.getAttribute("aria-label")?.replace("Collapse group ", ""),
        );

    await user.click(screen.getByRole("button", { name: "Status" }));
    expect(groupOrder()).toEqual(statusOrder);
    expect(screen.getByRole("columnheader", { name: "Status" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );

    await user.click(screen.getByRole("button", { name: "Status" }));
    expect(groupOrder()).toEqual([...statusOrder].reverse());
    expect(screen.getByRole("columnheader", { name: "Status" })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  it("excludes collapsed groups from the current-page selection scope", async () => {
    const user = userEvent.setup();
    const onVisibleRowsChange = vi.fn();
    render(<TemplateTable onVisibleRowsChange={onVisibleRowsChange} />);
    await user.click(
      screen.getByRole("button", { name: "Collapse group Acme" }),
    );
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(
      onVisibleRowsChange.mock.lastCall?.[0].map((row: Row) => row.id),
    ).toEqual(["c"]);
    await user.click(screen.getByRole("button", { name: "Expand group Acme" }));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(onVisibleRowsChange.mock.lastCall?.[0]).toHaveLength(3);
  });

  it("combines company filters with search and clears an empty result", async () => {
    const user = userEvent.setup();
    render(<TemplateTable />);
    await user.click(screen.getByRole("button", { name: "Filter by company" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Acme" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Gamma")).not.toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "Search records" }),
      "gamma",
    );
    expect(screen.getByText("No matching results.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("restores filters, grouping, column visibility and density from a saved view", async () => {
    const user = userEvent.setup();
    render(<TemplateTable />);
    await user.type(
      screen.getByRole("textbox", { name: "Search records" }),
      "alpha",
    );
    await user.click(screen.getByRole("button", { name: "View options" }));
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "Show Updated" }),
    );
    await user.click(
      screen.getByRole("menuitemradio", { name: "Compact rows" }),
    );
    await user.click(screen.getByRole("button", { name: "Create saved view" }));
    await user.type(
      screen.getByRole("textbox", { name: "Saved view name" }),
      "Review queue",
    );
    await user.click(screen.getByRole("button", { name: "Save view" }));
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    await user.click(screen.getByRole("button", { name: "View options" }));
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "Show Updated" }),
    );
    await user.click(
      screen.getByRole("menuitemradio", { name: "No grouping" }),
    );
    expect(screen.getByRole("button", { name: "Updated" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Saved views" }));
    await user.click(screen.getByRole("menuitem", { name: "Review queue" }));
    expect(screen.getByRole("textbox", { name: "Search records" })).toHaveValue(
      "alpha",
    );
    expect(
      screen.queryByRole("button", { name: "Updated" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse group Acme" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View options" }));
    expect(
      screen.getByRole("menuitemradio", { name: "Compact rows" }),
    ).toHaveAttribute("aria-checked", "true");
  }, 15000);
});
