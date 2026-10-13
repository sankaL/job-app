import { createRef } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { Button } from "@/components/ui/button";
import { ActionButtons } from "@/components/ui/button-group";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataTable } from "@/components/ui/data-table";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { ModalShell } from "@/components/ui/modal-shell";
import { ShellLayoutProvider, useShellLayout } from "@/components/layout/ShellLayoutContext";
import { PageHeader } from "@/components/layout/PageHeader";

function ActionHost() {
  const { setActionHost } = useShellLayout();
  return <header><div ref={setActionHost} data-testid="shell-actions" /></header>;
}
function HeaderTestShell({ children }: { children: React.ReactNode }) {
  return <ShellLayoutProvider><ActionHost />{children}</ShellLayoutProvider>;
}

// Exercise the contracts that must survive the Astryx migration.
describe("shared app controls", () => {
  it("portals page actions into the app shell header and clears them on navigation", async () => {
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
      { wrapper: HeaderTestShell },
    );
    expect(
      screen.getByRole("heading", { name: "Resumes", level: 1 }),
    ).toHaveClass("sr-only");
    expect(
      screen.queryByText("Duplicate page introduction"),
    ).not.toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Resumes actions" });
    expect(screen.getByTestId("shell-actions")).toContainElement(group);
    expect(document.querySelector(".app-floating-page-actions")).toBeNull();
    expect(group).toHaveClass("astryx-button-group");
    expect(group).toContainElement(
      screen.getByRole("button", { name: "Upload Resume" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Upload Resume" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Start from Scratch" }),
    );
    expect(upload).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(
      document.body.style.getPropertyValue("--floating-page-actions-height"),
    ).toBe("");
    rerender(<PageHeader title="Profile" />);
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(
      document.body.style.getPropertyValue("--floating-page-actions-height"),
    ).toBe("");
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
    expect(heading).toHaveTextContent(
      "Senior Engineering Practice Lead for Enterprise Platforms",
    );
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activity" })).toHaveClass("astryx-button");
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("groups icon and form actions across fragments and skips disabled actions with arrow keys", async () => {
    const submit = vi.fn((event) => event.preventDefault());
    render(<>
      <form id="grouped-form" onSubmit={submit} />
      <ActionButtons label="Resume editing">
        <IconButton aria-label="Rename">Edit</IconButton>
        <>
          <Button disabled>Unavailable</Button>
          <Button type="submit" form="grouped-form">Save</Button>
        </>
      </ActionButtons>
    </>);
    const rename = screen.getByRole("button", { name: "Rename" });
    const save = screen.getByRole("button", { name: "Save" });
    expect(rename).toHaveAttribute("data-size", "md");
    expect(save).toHaveAttribute("data-variant", "primary");
    expect(rename).toHaveAttribute("data-variant", "secondary");
    expect(screen.getByRole("group", { name: "Resume editing" }).querySelectorAll('[data-variant="primary"]')).toHaveLength(1);
    rename.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(save).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(submit).toHaveBeenCalledOnce();
    await userEvent.keyboard("{Home}");
    expect(rename).toHaveFocus();
  });

  it("renders a lone action as a regular button", () => {
    render(<ActionButtons label="Save"><>{false}<Button>Save</Button></></ActionButtons>);
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("data-variant", "primary");
  });

  it("keeps an explicitly chosen main action primary while disabled or loading", () => {
    const { rerender } = render(
      <ActionButtons label="Review" primaryIndex={0}>
        <Button loading>Review</Button>
        <Button variant="danger">Delete</Button>
      </ActionButtons>,
    );
    expect(screen.getByRole("button", { name: /Review/ })).toHaveAttribute("data-variant", "primary");
    expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute("data-variant", "destructive");
    rerender(<ActionButtons label="Review" primaryIndex={0}>
      <IconButton aria-label="Edit" disabled>Edit</IconButton>
      <IconButton aria-label="Delete" variant="danger">Delete</IconButton>
    </ActionButtons>);
    expect(screen.getByRole("button", { name: "Edit" })).toHaveAttribute("data-variant", "primary");
    const deleteIcon = screen.getByRole("button", { name: "Delete" });
    expect(deleteIcon).toHaveAttribute("data-variant", "destructive");
    expect(deleteIcon).toHaveClass("app-button-danger");
  });

  it("separates the primary action from delete with neutral actions in between", () => {
    render(
      <ActionButtons label="Resume actions" primaryIndex={1}>
        <Button variant="secondary">File Name</Button>
        <Button>Save Changes</Button>
        <IconButton aria-label="Delete resume" variant="danger">Delete</IconButton>
      </ActionButtons>,
    );
    const names = screen.getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(names).toEqual(["Save Changes", "File Name", "Delete resume"]);
    expect(screen.getByRole("button", { name: "Save Changes" })).toHaveAttribute("data-variant", "primary");
    expect(screen.getByRole("button", { name: "File Name" })).toHaveAttribute("data-variant", "secondary");
  });

  it("keeps delete actions solid red even as a group's primary action", () => {
    render(
      <ActionButtons label="Confirm">
        <Button variant="secondary">Cancel</Button>
        <Button variant="danger">Delete Resume</Button>
      </ActionButtons>,
    );
    const confirm = screen.getByRole("button", { name: "Delete Resume" });
    expect(confirm).toHaveAttribute("data-variant", "destructive");
    expect(confirm).toHaveClass("app-button-danger");
  });

  it("renders plain row actions as borderless coloured icons in source order", () => {
    render(
      <ActionButtons label="Row actions" size="sm" variant="plain">
        <IconButton aria-label="Edit">Edit</IconButton>
        <IconButton aria-label="Mark applied" tone="success">Check</IconButton>
        <IconButton aria-label="Delete" variant="danger">Delete</IconButton>
      </ActionButtons>,
    );
    expect(screen.getByRole("group", { name: "Row actions" })).toBeInTheDocument();
    const names = screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"));
    expect(names).toEqual(["Edit", "Mark applied", "Delete"]);
    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveAttribute("data-variant", "ghost");
      expect(button).toHaveClass("app-icon-plain");
    }
    expect(screen.getByRole("button", { name: "Edit" })).toHaveClass("app-icon-neutral");
    expect(screen.getByRole("button", { name: "Mark applied" })).toHaveClass("app-icon-success");
    const remove = screen.getByRole("button", { name: "Delete" });
    expect(remove).toHaveClass("app-icon-danger");
    expect(remove).not.toHaveClass("app-button-danger");
  });

  it("styles Astryx toasts by action type and keeps errors until dismissed", async () => {
    function Trigger() {
      const { toast } = useToast();
      return (
        <>
          <Button onClick={() => toast("Saved")}>Success toast</Button>
          <Button onClick={() => toast("Save failed", "error")}>Error toast</Button>
          <Button onClick={() => toast("Resume deleted", "destructive")}>Destructive toast</Button>
          <Button onClick={() => toast("Queued", "info")}>Info toast</Button>
        </>
      );
    }
    render(
      <Theme theme={neutralTheme} mode="light">
        <ToastProvider>
          <Trigger />
        </ToastProvider>
      </Theme>,
    );
    for (const name of ["Success", "Error", "Destructive", "Info"]) {
      fireEvent.click(screen.getByRole("button", { name: `${name} toast` }));
    }
    // The live region also announces each message, so match the toast card itself.
    const toastCard = (text: string) =>
      Array.from(document.querySelectorAll<HTMLElement>(".astryx-toast")).find((card) =>
        card.textContent?.includes(text),
      );
    const variantOf = (text: string) =>
      toastCard(text)?.querySelector("[data-app-toast-variant]")?.getAttribute("data-app-toast-variant");
    await waitFor(() => expect(toastCard("Queued")).toBeDefined());
    expect(variantOf("Saved")).toBe("success");
    expect(variantOf("Save failed")).toBe("error");
    expect(variantOf("Resume deleted")).toBe("destructive");
    expect(variantOf("Queued")).toBe("info");
    expect(toastCard("Save failed")).toHaveAttribute("role", "alert");
    expect(toastCard("Saved")).toHaveAttribute("role", "status");
    // A completed destructive action is red but is not an alert.
    expect(toastCard("Resume deleted")).toHaveAttribute("role", "status");

    // jsdom reports the toast viewport's top-layer popover as hidden.
    fireEvent.click(
      within(toastCard("Save failed")!).getByRole("button", { name: "Dismiss", hidden: true }),
    );
    // jsdom runs no CSS transitions, so finish the row's exit the way Astryx's own tests do.
    const errorRow = toastCard("Save failed")!.closest<HTMLElement>("[data-toast-id]")!;
    fireEvent.transitionEnd(errorRow, { propertyName: "grid-template-rows" });
    await waitFor(() => expect(toastCard("Save failed")).toBeUndefined());
    expect(toastCard("Saved")).toBeDefined();
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
    await userEvent.click(screen.getByRole("button", { name: "Filter" }));
    await userEvent.click(
      screen.getByRole("menuitemradio", { name: "Complete" }),
    );
    expect(onChange.mock.calls[0][0].target.value).toBe("complete");
    ref.current?.setSelectionRange(1, 4);
    expect(ref.current?.selectionStart).toBe(1);
    expect(ref.current?.selectionEnd).toBe(4);
  });

  it("selects with the keyboard, blocks disabled options and retains native validation and form data", async () => {
    const user = userEvent.setup();
    const field = createRef<HTMLSelectElement>();
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form aria-label="Settings" onSubmit={submit}>
        <Select
          ref={field}
          name="choice"
          aria-label="Choice"
          required
          defaultValue=""
        >
          <option value="">Choose</option>
          <option value="unavailable" disabled>
            Unavailable
          </option>
          <option value="complete">Complete</option>
        </Select>
        <Button type="submit">Submit settings</Button>
        <Button type="reset">Reset settings</Button>
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "Submit settings" }));
    expect(submit).not.toHaveBeenCalled();
    expect(field.current?.validity.valueMissing).toBe(true);
    const trigger = screen.getByRole("button", { name: "Choice" });
    await user.click(trigger);
    const unavailable = screen.getByRole("menuitemradio", {
      name: "Unavailable",
    });
    expect(unavailable).toHaveAttribute("aria-disabled", "true");
    await user.click(unavailable);
    expect(field.current?.value).toBe("");
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(screen.getByRole("menuitemradio", { name: "Choose" })).toHaveFocus());
    await user.keyboard("{End}");
    await waitFor(() => expect(screen.getByRole("menuitemradio", { name: "Complete" })).toHaveFocus());
    await user.keyboard("{Enter}");
    expect(trigger).toHaveTextContent("Complete");
    expect(field.current?.validity.valid).toBe(true);
    expect(new FormData(field.current!.form!).get("choice")).toBe("complete");
    await user.click(screen.getByRole("button", { name: "Submit settings" }));
    expect(submit).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Reset settings" }));
    await waitFor(() => expect(trigger).toHaveTextContent("Choose"));
    expect(field.current?.value).toBe("");
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
