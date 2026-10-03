import { createRef } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/ui/data-table";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { ModalShell } from "@/components/ui/modal-shell";
import { PageHeader } from "@/components/layout/PageHeader";

// Exercise the contracts that must survive the Astryx migration.
describe("shared app controls", () => {
  it("keeps page actions usable in one floating group and cleans up on navigation", async () => {
    const upload = vi.fn();
    const create = vi.fn();
    const { rerender, unmount } = render(
      <PageHeader
        title="Resumes"
        subtitle="Duplicate page introduction"
        actions={
          <>
            <Button onClick={upload}>Upload Resume</Button>
            <Button onClick={create}>Start from Scratch</Button>
          </>
        }
      />,
    );
    expect(screen.getByRole("heading", { name: "Resumes", level: 1 })).toHaveClass("sr-only");
    expect(screen.queryByText("Duplicate page introduction")).not.toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Resumes actions" });
    expect(group).toContainElement(screen.getByRole("button", { name: "Upload Resume" }));
    await userEvent.click(screen.getByRole("button", { name: "Upload Resume" }));
    await userEvent.click(screen.getByRole("button", { name: "Start from Scratch" }));
    expect(upload).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(document.body.style.getPropertyValue("--floating-page-actions-height")).not.toBe("");
    rerender(<PageHeader title="Profile" />);
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(document.body.style.getPropertyValue("--floating-page-actions-height")).toBe("");
    unmount();
  });

  it("keeps the full application title and company in the body", () => {
    render(
      <PageHeader
        hasBodyHeading
        title="Senior Engineering Practice Lead for Enterprise Platforms"
        subtitle="Acme"
        actions={<Button>Activity</Button>}
      />,
    );
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).not.toHaveClass("sr-only");
    expect(heading).toHaveTextContent("Senior Engineering Practice Lead for Enterprise Platforms");
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /actions$/ })).toContainElement(screen.getByRole("button", { name: "Activity" }));
  });

  it("cleans up toast removal and automatic-dismiss timers on unmount", () => {
    vi.useFakeTimers();
    try {
      function Trigger() {
        const { toast } = useToast();
        return <Button onClick={() => toast("Saved")}>Show toast</Button>;
      }
      const { unmount } = render(
        <ToastProvider>
          <Trigger />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Show toast" }));
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      fireEvent.click(screen.getByRole("button", { name: "Show toast" }));
      expect(vi.getTimerCount()).toBe(2);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
      act(() => vi.runAllTimers());
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps pending dialogs open for Escape and backdrop clicks", () => {
    const close = vi.fn();
    const confirmation = render(
      <ConfirmModal
        open
        loading
        title="Delete resume"
        onCancel={close}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close confirmation" }));
    expect(close).not.toHaveBeenCalled();
    confirmation.unmount();
    const modal = render(
      <ModalShell
        open
        closeDisabled
        title="Edit job"
        description="Job fields"
        icon={null}
        closeLabel="Close job"
        onClose={close}
      >
        <Input aria-label="Role" />
      </ModalShell>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close job" }));
    expect(close).not.toHaveBeenCalled();
    modal.unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("retains native titles, disabled behavior, complex content and refs", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} disabled title="Save is unavailable" onClick={onClick}>
        <svg aria-hidden="true" />
        <span>Save Draft</span>
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save Draft" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Save is unavailable");
    expect(ref.current).toBe(button);
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("prevents submission while loading", async () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <Button loading type="submit">
          Save
        </Button>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(submit).not.toHaveBeenCalled();
  });

  it("keeps numeric validation and checkbox semantics", () => {
    const onChange = vi.fn();
    render(
      <>
        <Input
          aria-label="Allowance"
          type="number"
          min={1}
          required
          defaultValue={0}
        />
        <Input aria-label="Applied" type="checkbox" onChange={onChange} />
      </>,
    );
    const number = screen.getByRole("spinbutton", {
      name: "Allowance",
    }) as HTMLInputElement;
    expect(number.validity.rangeUnderflow).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Applied" }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(screen.getByRole("checkbox", { name: "Applied" })).toBeChecked();
  });

  it("keeps native select change events and textarea selection refs", async () => {
    const onChange = vi.fn();
    const ref = createRef<HTMLTextAreaElement>();
    render(
      <>
        <Select aria-label="Filter" onChange={onChange}>
          <option value="all">All</option>
          <option value="complete">Complete</option>
        </Select>
        <Textarea aria-label="Section" defaultValue="Python" ref={ref} />
      </>,
    );
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Filter" }),
      "complete",
    );
    expect(onChange.mock.calls[0][0].target.value).toBe("complete");
    ref.current?.setSelectionRange(1, 4);
    expect(ref.current?.selectionStart).toBe(1);
    expect(ref.current?.selectionEnd).toBe(4);
  });

  it("restores document theme attributes when leaving the authenticated app", () => {
    const previousTheme = document.documentElement.getAttribute("data-theme");
    const previousAstryx =
      document.documentElement.getAttribute("data-astryx-theme");
    const { unmount } = render(
      <Theme theme={neutralTheme} mode="light">
        <Button>Continue</Button>
      </Theme>,
    );
    expect(document.documentElement).toHaveAttribute(
      "data-astryx-theme",
      "neutral",
    );
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    unmount();
    expect(document.documentElement.getAttribute("data-theme")).toBe(
      previousTheme,
    );
    expect(document.documentElement.getAttribute("data-astryx-theme")).toBe(
      previousAstryx,
    );
  });

  it("sorts and opens table rows from the keyboard without activating child actions", async () => {
    const onRowClick = vi.fn();
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTable
        columns={[
          {
            key: "name",
            header: "Name",
            width: "180px",
            sortable: true,
            render: (row: { id: string; name: string }) => row.name,
          },
          {
            key: "action",
            header: "Action",
            width: "120px",
            render: () => (
              <Button
                onClick={(event) => {
                  event.stopPropagation();
                  onAction();
                }}
              >
                Action
              </Button>
            ),
          },
        ]}
        data={[
          { id: "b", name: "Zulu" },
          { id: "a", name: "Alpha" },
        ]}
        getRowKey={(row) => row.id}
        onRowClick={onRowClick}
      />,
    );
    const sort = screen.getByRole("button", { name: "Name" });
    sort.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Alpha");
    rows[1].focus();
    await user.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenCalledWith({ id: "a", name: "Alpha" });
    screen.getAllByRole("button", { name: "Action" })[0].focus();
    await user.keyboard("{Enter}");
    expect(onAction).toHaveBeenCalledOnce();
    expect(onRowClick).toHaveBeenCalledOnce();
  });
});
