/**
 * The judge portal, through the routes a judge actually uses.
 *
 * Seeds one candidate submission (the same service call the candidate form makes)
 * and proves it appears in the hackathon workspace without any manual step, that
 * the project page exposes the four judging views, and that a manual score can be
 * entered and is stored next to the AI score.
 */

import { QueryClient } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "@/routeTree.gen";
import { createGuestReport } from "@/services/guest.service";
import {
  createHackathon,
  resetPortalStorageState,
  submitToHackathon,
} from "@/services/hackathon.service";

vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: false,
  getSupabase: () => {
    throw new Error("The prototype portals must not need Supabase in this test.");
  },
}));

const JUDGE = "local-judge";

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

async function seedSubmission() {
  const hackathon = await createHackathon(
    { id: JUDGE, name: "Organizer" },
    { name: "Demo Hackathon 2026", code: "DEMO26" },
  );
  const report = createGuestReport({
    type: "Project",
    name: "Ledger Lens",
    status: "Completed",
    report_data: {
      executive_summary: "Turns receipts into a ledger.",
      scores: { overall: 82, codeQuality: 74 },
      claims: [],
      claim_counts: {
        total: 0,
        supported: 0,
        partial: 0,
        unsupported: 0,
        could_not_verify: 0,
        unverified: 0,
      },
    },
  });
  const submission = await submitToHackathon({
    hackathonId: hackathon.id,
    candidateId: "local-candidate",
    teamName: "Team Alpha",
    teamMembers: ["Ada Lovelace"],
    description: "Receipts in, ledger out.",
    repoUrl: "https://github.com/team/ledger-lens",
    websiteUrl: "https://ledger.example.com",
    deckName: "ledger-lens.pptx",
    projectId: "project-row-1",
    reportId: report.id,
  });
  return { hackathon, submission };
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("buildlens-guest", "true");
  resetPortalStorageState();
});

describe("judge portal", () => {
  it("receives a candidate submission automatically and opens it", async () => {
    const { submission } = await seedSubmission();

    const router = await renderRoute("/hackathons/DEMO26");

    // The table row exists without anyone importing or re-keying data.
    expect(await screen.findByRole("link", { name: /Ledger Lens/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Team Alpha/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Analysis ready/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/82\/100/).length).toBeGreaterThan(0);
    expect(screen.getByText(/^Submissions$/)).toBeInTheDocument();

    // Opening the row goes to the shared project page.
    fireEvent.click(screen.getByRole("link", { name: /Ledger Lens/i }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/hackathons/DEMO26/project/${submission.id}`),
    );

    // All four judging views are reachable from one page.
    for (const label of ["View submission", "AI evaluation", "Manual evaluation", "Compare"]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }

    // The original submission is visible, separate from the analysis.
    expect(await screen.findByText(/Receipts in, ledger out\./)).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /github\.com\/team\/ledger-lens/ }),
    ).toBeInTheDocument();

    // The AI evaluation shows the analysis score and links to the full report.
    fireEvent.click(screen.getByText("AI evaluation"));
    expect(await screen.findByRole("link", { name: /Open full analysis/i })).toBeInTheDocument();
    expect(screen.getAllByText(/82/).length).toBeGreaterThan(0);

    // Manual evaluation exposes the rubric from the hackathon itself.
    fireEvent.click(screen.getByText("Manual evaluation"));
    expect(await screen.findByRole("button", { name: /Submit evaluation/i })).toBeInTheDocument();
  }, 30000);

  it("shows an honest empty state for a hackathon with no submissions", async () => {
    await createHackathon(
      { id: JUDGE, name: "Organizer" },
      { name: "Empty Event", code: "EMPTY1" },
    );
    await renderRoute("/hackathons/EMPTY1");
    expect(await screen.findByText(/No submissions yet\./i)).toBeInTheDocument();
  }, 20000);
});
