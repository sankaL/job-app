import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApplicationActivityItem } from "@/components/applications/ApplicationActivityItem";

describe("keyword optimization activity details", () => {
  it("shows the level, before and after coverage and the added keywords", () => {
    render(
      <ApplicationActivityItem
        expanded
        onToggle={vi.fn()}
        item={{
          id: "evt-1",
          type: "keyword_optimization_succeeded",
          status: "success",
          title: "Keyword optimization completed",
          summary: "Keyword coverage went from 32% to 40% (2 keywords added).",
          created_at: "2026-10-14T12:00:00Z",
          details: {
            aggressiveness: "high",
            starting_percentage: 32,
            ending_percentage: 40,
            starting_matched_count: 8,
            ending_matched_count: 10,
            total_count: 25,
            added_keywords: ["React", "Vitest"],
          },
        }}
      />,
    );

    expect(screen.getByText("Keyword coverage went from 32% to 40% (2 keywords added).")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText("32% → 40%")).toBeInTheDocument();
    expect(screen.getByText("8 of 25 → 10 of 25")).toBeInTheDocument();
    expect(screen.getByText("React, Vitest")).toBeInTheDocument();
  });

  it("shows only the starting coverage for a started entry", () => {
    render(
      <ApplicationActivityItem
        expanded
        onToggle={vi.fn()}
        item={{
          id: "evt-2",
          type: "keyword_optimization_started",
          status: "info",
          title: "Keyword optimization started",
          summary: "Resume keyword optimization started.",
          created_at: "2026-10-14T11:59:00Z",
          details: {
            aggressiveness: "medium",
            starting_percentage: 32,
            starting_matched_count: 8,
            total_count: 25,
          },
        }}
      />,
    );

    expect(screen.getByText("32%")).toBeInTheDocument();
    expect(screen.getByText("8 of 25")).toBeInTheDocument();
    expect(screen.queryByText(/^Added:/)).not.toBeInTheDocument();
  });
});
