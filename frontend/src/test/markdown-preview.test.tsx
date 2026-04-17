import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownPreview } from "@/components/MarkdownPreview";

describe("markdown preview", () => {
  it("renders list items with explicit marker classes", () => {
    render(
      <MarkdownPreview
        content={"## Experience\n- Built APIs\n- Improved reliability\n\n## Steps\n1. Scoped the fix\n2. Added a test"}
      />,
    );

    const bulletItem = screen.getByText("Built APIs").closest("li");
    const orderedItem = screen.getByText("Scoped the fix").closest("li");

    expect(bulletItem).toHaveClass("list-item");
    expect(bulletItem?.parentElement).toHaveClass("list-disc", "pl-6");
    expect(orderedItem).toHaveClass("list-item");
    expect(orderedItem?.parentElement).toHaveClass("list-decimal", "pl-6");
  });
});
