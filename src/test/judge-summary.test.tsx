/**
 * The default submission screen must answer the judge's first question in plain
 * language, and it must never be blank: no run, a failed run and a completed run
 * each say something useful.
 */

import { QueryClient } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { JudgeSummary } from "@/components/evaluation/JudgeSummary";
import { CLAIM_STATUS_DISCLAIMER, type EvidenceBundle } from "@/services/evidence/types";
import { buildInspectionReport } from "@/services/inspection";
import type { ProjectDetail } from "@/types/evaluation";

const project: ProjectDetail = {
  id: "project:1",
  category: "project",
  source: "workspace",
  name: "AquaSense",
  subtitle: null,
  description: "Smart irrigation for farmers.",
  tags: ["React"],
  yearsExperience: null,
  projectCategory: "Submitted",
  createdAt: "2026-02-01T00:00:00.000Z",
  team: null,
  problemStatement: null,
  solution: null,
  technologies: ["React"],
  repoUrl: "https://github.com/acme/aquasense",
  demoUrl: "https://aquasense.example.com",
  media: [],
  teamMembers: [],
  submitted: [],
  presentationClaims: null,
};

const bundle: EvidenceBundle = {
  generatedAt: "2026-02-01T00:00:00.000Z",
  sources: [
    {
      kind: "repository",
      label: "GitHub repository",
      status: "ingested",
      readable: true,
      url: "https://github.com/acme/aquasense",
      detail: "Repository acme/aquasense was inspected.",
      highlights: ["Frameworks detected: React."],
      observations: [
        {
          id: "repo.code.auth",
          area: "repository",
          label: "Authentication implementation",
          status: "good",
          result: "Authentication code was found (src/auth/session.ts).",
          evidence: ["src/auth/session.ts"],
          confidence: "high",
        },
      ],
    },
  ],
  claims: [
    {
      id: "deck.feature.0",
      claim: "Google authentication for farm managers",
      category: "features",
      status: "supported",
      sources: ["repository"],
      quotes: ["Authentication code was found (src/auth/session.ts)."],
      note: "The repository contains the authentication flow this claim describes.",
      kind: "features",
    },
    {
      id: "deck.impact.0",
      claim: "Used by 12 farms in Kenya",
      category: "impact",
      status: "could_not_verify",
      sources: [],
      quotes: [],
      note: "Could not verify: no source with usage data was provided.",
      kind: "general",
    },
  ],
  gaps: [],
  counts: { supported: 1, partially_supported: 0, not_found: 0, could_not_verify: 1 },
  disclaimer: CLAIM_STATUS_DISCLAIMER,
};

const report = buildInspectionReport({ detail: project, bundle, evaluation: null });

function renderSummary(props: { report: typeof report | null; error?: string | null }) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <JudgeSummary
        submissionId={project.id}
        report={props.report}
        phase={props.report ? "ready" : props.error ? "error" : "idle"}
        partial={Boolean(props.report && props.error)}
        error={props.error ?? null}
        starting={false}
        onStart={() => {}}
      />
    ),
  });
  const analysisRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/evaluation/project/$id/analysis",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, analysisRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
    context: { queryClient: new QueryClient() },
  });
  render(<RouterProvider router={router} />);
}

describe("JudgeSummary", () => {
  it("leads with the score, the verdict and the claim and feature tables", async () => {
    renderSummary({ report });

    expect(await screen.findByText(/1 claim could not be fully verified/i)).toBeInTheDocument();
    // First screen: score, executive verdict, breakdown, then the two tables.
    expect(screen.getByText("Overall score")).toBeInTheDocument();
    expect(screen.getByText("Executive verdict")).toBeInTheDocument();
    expect(screen.getByText("Score breakdown")).toBeInTheDocument();
    expect(screen.getByText("Key concerns")).toBeInTheDocument();
    expect(screen.getByText("Key strengths")).toBeInTheDocument();
    // "Claim verification" is both a breakdown dimension and the table heading.
    expect(screen.getAllByText("Claim verification").length).toBeGreaterThan(0);
    expect(screen.getByText("Feature verification")).toBeInTheDocument();
    expect(screen.getByText("Verdict")).toBeInTheDocument();
    expect(screen.getByText("Tested")).toBeInTheDocument();
    // The claim table names the claim and its verdict, without an accordion.
    expect(screen.getAllByText("Google authentication for farm managers").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("Supported").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Could not verify").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /view detailed analysis/i })).toHaveAttribute(
      "href",
      expect.stringContaining("/analysis"),
    );
  });

  it("shows 'could not verify' instead of inventing a finding", async () => {
    renderSummary({ report: null, error: "The evidence service could not be reached." });
    expect(await screen.findByText("Could not verify this submission")).toBeInTheDocument();
    expect(screen.getByText(/evidence service could not be reached/i)).toBeInTheDocument();
  });
});
