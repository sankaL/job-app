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
  return screen.getAllByRole("row").slice(1).map((row) => row.textContent ?? "");
}

function FilterableTable() {
  const [query, setQuery] = useState("");
  const rows: Row[] = Array.from({ length: 26 }, (_, index) => ({
    id: `row-${index + 1}`,
    label: index === 25 ? "Target role" : `Role ${index + 1}`,
    updated: index + 1,
  }));
  const filteredRows = rows.filter((row) => row.label.toLowerCase().includes(query.toLowerCase()));

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
