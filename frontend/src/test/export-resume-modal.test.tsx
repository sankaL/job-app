import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExportResumeModal } from "@/components/applications/ExportResumeModal";
import * as api from "@/lib/api";
import { buildFilenameValues } from "@/lib/exportFilename";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  listExportStyles: vi.fn(),
}));

const STYLES: api.ExportStyleOption[] = [
  { key: "classic", label: "Classic", description: "Serif.", is_default: true },
  { key: "modern", label: "Modern", description: "Sans.", is_default: false },
  { key: "compact", label: "Compact", description: "Dense.", is_default: false },
  { key: "executive", label: "Executive", description: "Garamond.", is_default: false },
  { key: "minimal", label: "Minimal", description: "Light.", is_default: false },
];

function renderModal(props: Partial<Parameters<typeof ExportResumeModal>[0]> = {}) {
  const onExport = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ExportResumeModal
        open
        savedStyle={null}
        filenameTemplate={null}
        filenameValues={buildFilenameValues({ fullName: "Alex Example", company: "Acme" })}
        exportingFormat={null}
        error={null}
        onClose={vi.fn()}
        onExport={onExport}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onExport };
}

describe("ExportResumeModal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.listExportStyles).mockResolvedValue(STYLES);
  });

  it("pre-selects the saved style and supports arrow-key selection", async () => {
    const user = userEvent.setup();
    const { onExport } = renderModal({ savedStyle: "executive", filenameTemplate: "{full name} {company}" });
    const executive = await screen.findByRole("radio", { name: "Executive style" });
    expect(executive).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("export-filename-preview")).toHaveTextContent("Alex Example Acme.pdf");

    executive.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Minimal style" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: /download pdf/i }));
    expect(onExport).toHaveBeenCalledWith("pdf", "minimal");
  });

  it("falls back to the default style when the saved style is unknown", async () => {
    renderModal({ savedStyle: "retired" as api.ExportStyleKey });
    expect(await screen.findByRole("radio", { name: "Classic style" })).toHaveAttribute("aria-checked", "true");
  });

  it("shows a load error and blocks download when styles cannot load", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listExportStyles).mockRejectedValue(new Error("network"));
    const { onExport } = renderModal();
    expect(await screen.findByText(/Export styles could not be loaded/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /download pdf/i }));
    expect(onExport).not.toHaveBeenCalled();
  });

  it("keeps an export error visible inside the dialog", async () => {
    renderModal({ error: "PDF export failed." });
    const dialog = await screen.findByRole("dialog", { name: /export resume/i });
    expect(within(dialog).getByText("PDF export failed.")).toBeInTheDocument();
  });
});
