import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "@/components/ui/markdown-editor";

describe("markdown editor", () => {
  it("highlights markdown headers and subheaders", () => {
    render(
      <MarkdownEditor
        aria-label="Markdown editor"
        value={"# Main Header\n## Section Header\n### Subheader\nBody copy"}
        onChange={() => {}}
      />,
    );

    expect(screen.getByText("# Main Header")).toHaveClass("heading-1");
    expect(screen.getByText("## Section Header")).toHaveClass("heading-2");
    expect(screen.getByText("### Subheader")).toHaveClass("heading-3");
    expect(screen.getByText("Body copy")).toHaveClass("body-line");
  });

  it("keeps emitting plain markdown through textarea change events", () => {
    const onValueChange = vi.fn();

    function Harness() {
      const [value, setValue] = useState("");
      return (
        <MarkdownEditor
          aria-label="Markdown editor"
          value={value}
          onChange={(event) => {
            onValueChange(event.target.value);
            setValue(event.target.value);
          }}
        />
      );
    }

    render(<Harness />);

    const editor = screen.getByLabelText("Markdown editor");
    fireEvent.change(editor, {
      target: { value: "## Updated Section\n- Bullet" },
    });

    expect(onValueChange).toHaveBeenCalledWith("## Updated Section\n- Bullet");
    expect(editor).toHaveValue("## Updated Section\n- Bullet");
  });
});
