import { QueryClient } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";
import { createGuestReport } from "@/services/guest.service";

const GUEST_KEY = "buildlens-guest";

// Recharts' ResponsiveContainer needs ResizeObserver, which jsdom does not ship.
if (!("ResizeObserver" in globalThis)) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}

async function renderRoute(path: string): Promise<AnyRouter> {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient: new QueryClient() },
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

describe("report page", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(GUEST_KEY, "true");
  });

  it("renders stored scores and structured sections for a completed report", async () => {
    const report = createGuestReport({
      type: "Project",
      name: "Nimbus Analytics",
      status: "Completed",
      report_data: {
        executive_summary: "Nimbus ships a tested analytics core with a clean data model.",
        overview: {
          summary: "Event analytics for small teams.",
          highlights: ["Typed end to end", "Deterministic scoring fixtures"],
        },
        architecture: {
          summary: "React client over an edge API.",
          stack: ["React", "Postgres"],
        },
        security: {
          summary: "Row level security covers every table.",
          findings: [{ title: "Missing rate limit", severity: "high", detail: "Public ingest" }],
        },
        performance: {
          summary: "Fast first paint.",
          vitals: [{ name: "LCP", value: 2.1, unit: "s", threshold: 2.5, good: true }],
        },
        maintainability: { summary: "Small, focused modules." },
        scores: {
          overall: 87,
          evidence: 82,
          codeQuality: 88,
          security: 74,
          performance: 79,
          maintainability: 85,
        },
        risks: [{ title: "Unbounded queue", severity: "medium", mitigation: "Add a cap" }],
        recommendations: [{ title: "Split the bundle", priority: "high" }],
      },
    });

    await renderRoute(`/report/${report.id}`);

    // Header + stored score (not a hardcoded value).
    expect(await screen.findByRole("heading", { name: /Nimbus Analytics/i })).toBeInTheDocument();
    expect(screen.getAllByText("87").length).toBeGreaterThan(0);
    expect(screen.queryByText("Atlas — Climate Risk Dashboard")).toBeNull();

    // Status reflects the stored value.
    expect(screen.getAllByText(/Completed/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Live report data/i)).toBeInTheDocument();

    // Required sections exist, including the derived AI verdict section.
    for (const title of [
      "AI Verdict",
      "AI Analysis & Pre-Assessment",
      "Executive Summary",
      "Project Overview",
      "Architecture / Technology Stack",
      "Code Quality",
      "Security",
      "Performance",
      "Maintainability",
      "Risks / Findings",
      "Recommendations",
      "Overall Score",
    ]) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }

    // Real payload content is rendered, including recommendations and risks.
    expect(
      screen.getByText(/Nimbus ships a tested analytics core with a clean data model\./i),
    ).toBeInTheDocument();
    expect(screen.getByText("Split the bundle")).toBeInTheDocument();
    expect(screen.getAllByText("Unbounded queue").length).toBeGreaterThan(0);
  }, 20000);

  it("shows deck claims under an unverified-claims disclaimer", async () => {
    const report = createGuestReport({
      type: "Project",
      name: "AquaSense",
      status: "Completed",
      // Exactly the shape the analysis pipeline writes under `submission`.
      report_data: {
        executive_summary: "AquaSense couples IoT probes with an ML irrigation model.",
        scores: { overall: 74 },
        submission: {
          document_analysis: {
            status: "success",
            file_name: "aquasense.pptx",
            file_type: "pptx",
            total_pages: 6,
            chars_extracted: 1450,
            method: "native",
            ocr_applied: false,
            error: null,
            warnings: [],
            pages: [{ page: 1, chars: 220, source: "native" }],
            claims: {
              summary: "AquaSense — Smart Irrigation",
              problem: ["Farmers cannot see soil moisture in real time"],
              solution: ["Low-cost IoT soil probes with an on-device ML model"],
              features: ["Real-time moisture map"],
              technology: ["React", "TensorFlow and Supabase"],
              impact: ["We reduced water usage by 30% in field trials"],
              method: "heuristic",
            },
            summary: "AquaSense — Smart Irrigation",
            extracted_at: "2026-02-01T00:00:00.000Z",
            disclaimer:
              "Claims from the submitted document — these are the team's own assertions, not automatically verified facts. The evaluation pipeline compares them against the GitHub repository and the deployed website.",
          },
        },
      },
    });

    await renderRoute(`/report/${report.id}`);

    // The section is only rendered when the payload actually carries a deck.
    const trigger = await screen.findByRole("button", { name: /Document Analysis/i });
    fireEvent.click(trigger);

    expect(await screen.findByText(/not automatically verified facts/i)).toBeInTheDocument();
    expect(screen.getByText(/Farmers cannot see soil moisture in real time/)).toBeInTheDocument();
    expect(screen.getByText(/We reduced water usage by 30%/)).toBeInTheDocument();
    // The file name now appears twice on purpose: in the "Documents processed"
    // pipeline stage and in the document analysis section.
    expect(screen.getAllByText(/aquasense\.pptx/).length).toBeGreaterThan(0);
  }, 20000);

  it("does not present an in-progress report as finished", async () => {
    const report = createGuestReport({
      type: "Project",
      name: "Nimbus Analytics",
      status: "In Progress",
      report_data: null,
    });

    await renderRoute(`/report/${report.id}`);

    expect(await screen.findByRole("heading", { name: /Nimbus Analytics/i })).toBeInTheDocument();
    expect(screen.getAllByText("In Progress").length).toBeGreaterThan(0);
    expect(screen.getByText(/Analysis is still running/i)).toBeInTheDocument();
    expect(screen.getByText(/Awaiting analysis data/i)).toBeInTheDocument();
    // No fabricated score: the rings render the em dash instead of a number.
    expect(screen.queryByText("87")).toBeNull();
    expect(screen.queryByText("Strong submission")).toBeNull();
    expect(screen.getByText(/No score stored for this report\./i)).toBeInTheDocument();
  }, 20000);

  it("shows a failed state for a failed report", async () => {
    const report = createGuestReport({
      type: "Project",
      name: "Nimbus Analytics",
      status: "Failed",
      report_data: { overview: { summary: "Partial data only." } },
    });

    await renderRoute(`/report/${report.id}`);

    expect(await screen.findByRole("heading", { name: /Nimbus Analytics/i })).toBeInTheDocument();
    expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
    expect(screen.getByText(/analysis could not complete/i)).toBeInTheDocument();
  }, 20000);

  it("explains that guest reports cannot be recovered when storage is cleared", async () => {
    const report = createGuestReport({
      type: "Project",
      name: "Nimbus Analytics",
      status: "Completed",
    });
    window.localStorage.clear();
    window.localStorage.setItem(GUEST_KEY, "true");

    await renderRoute(`/report/${report.id}`);

    expect(
      await screen.findByText(/This report isn't available in this browser/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/local storage was cleared/i)).toBeInTheDocument();
  }, 20000);
});
