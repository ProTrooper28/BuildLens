/**
 * Claim extraction → registration → scoring regression test.
 *
 * The failure this guards against: a report that says "No claims recorded"
 * while the submitted deck and README are full of claims. Claims must be
 * extracted from BOTH sources, deduplicated, registered, verified against the
 * inspected evidence and carried into `report_data` so the report can render
 * them — and the overall score must react to what could not be backed.
 */

import { describe, expect, it, vi } from "vitest";

import { runProjectAnalysis, type AnalysisPersistence } from "@/analysis/analysis.service";
import type { AnalysisInput } from "@/analysis/types";
import { normalizeReportData } from "@/lib/report-data";
import {
  claimRegistrationError,
  claimScoreDeduction,
  computeEvidenceScore,
  registerClaims,
} from "@/services/claims";
import type { DocumentAnalysis } from "@/services/document/types";
import {
  createFetchMock,
  githubRepositoryRoutes,
  GITHUB_REPO_URL,
} from "@/test/fixtures/repository";
import type { Json, ReportStatus } from "@/types/database";

// The pipeline must never reach Supabase: persistence is injected.
vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: false,
  getSupabase: () => {
    throw new Error("The analysis pipeline must not call Supabase directly.");
  },
}));

/* ------------------------------------------------------------------ fixtures */

const README = `# Acme App

Acme App is a student verification platform for universities.

## Features

- Document upload for ID cards
- Upload student ID documents for verification.
- Export verification results as a CSV report.
- Shows an analytics dashboard with live verification metrics.
- Provides an AI chatbot that answers enrolment questions.
- Verify a student's identity against the university registry.

## Architecture

The backend is a REST API served by Express and backed by PostgreSQL.

## Tech stack

The frontend is built with React and Vite.

## Security

Uploaded documents are encrypted at rest.
`;

const README_URL = "https://raw.githubusercontent.com/acme/app/main/README.md";

/** 5 feature claims + 2 technology + 1 performance + 1 security + framing. */
const DECK_CLAIMS = {
  summary: "Acme App verifies student IDs in real time.",
  problem: ["Students wait hours for manual identity checks."],
  solution: ["An automated flow that checks a student ID in seconds."],
  features: [
    "Real-time face verification at campus gates",
    "Document upload for ID cards",
    "CSV export of the daily report",
    "Analytics dashboard with live metrics",
    "AI chatbot that answers enrolment questions",
    "Loads the dashboard in under 2 seconds",
    "Encrypts uploaded ID documents at rest",
  ],
  technology: ["React", "TensorFlow"],
  impact: ["Used by 12 universities"],
  method: "heuristic" as const,
};

const DECK: DocumentAnalysis = {
  extraction: {
    fileName: "acme-deck.pptx",
    fileSizeBytes: 4096,
    kind: "pptx",
    totalPages: 3,
    pages: [
      {
        page: 1,
        text: `${DECK_CLAIMS.summary} ${DECK_CLAIMS.problem.join(" ")}`,
        source: "native",
      },
      { page: 2, text: DECK_CLAIMS.solution.join(" "), source: "native" },
      { page: 3, text: DECK_CLAIMS.features.join(" "), source: "native" },
    ],
    fullText: [...DECK_CLAIMS.features, ...DECK_CLAIMS.technology].join(" "),
    method: "native",
    status: "success" as const,
    ocrAttempted: false,
    ocrApplied: false,
    error: null,
    warnings: [],
    extractedAt: "2026-01-01T00:00:00.000Z",
  },
  claims: {
    summary: DECK_CLAIMS.summary,
    problem: DECK_CLAIMS.problem,
    solution: DECK_CLAIMS.solution,
    features: DECK_CLAIMS.features,
    technology: DECK_CLAIMS.technology,
    impact: DECK_CLAIMS.impact,
    method: "heuristic",
  },
};

function inputWith(document: DocumentAnalysis | null): AnalysisInput {
  return {
    projectId: null,
    reportId: "11111111-1111-4111-8111-111111111111",
    name: "Acme App",
    repoUrl: GITHUB_REPO_URL,
    websiteUrl: "https://acme.example.com",
    notes: null,
    attachments: [{ name: "acme-deck.pptx", size: 4096, type: "application/vnd.ms-powerpoint" }],
    document,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function persistence(): AnalysisPersistence {
  return {
    async update(_patch: { status: ReportStatus; score: number | null; report_data: Json }) {
      /* captured by the caller through the run result */
    },
  };
}

function fetchWithReadme() {
  const base = githubRepositoryRoutes();
  return createFetchMock((url) => (url === README_URL ? { status: 200, body: README } : base(url)));
}

function payload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/* -------------------------------------------------------------------- tests */

describe("claim extraction and registration", () => {
  it("extracts claims from BOTH the deck and the README, deduplicates and registers them", async () => {
    const { fetchImpl } = fetchWithReadme();
    const result = await runProjectAnalysis({
      input: inputWith(DECK),
      persistence: persistence(),
      fetchImpl,
    });

    expect(result.status).toBe("Completed");

    const data = payload(result.reportData);
    const stats = payload(data["claim_pipeline"]);

    // 1–2. Both sources contribute.
    expect(Number(stats["deck"])).toBeGreaterThanOrEqual(10);
    expect(Number(stats["readme"])).toBeGreaterThanOrEqual(6);

    // 4. Deduplication merges the statement that appears in both.
    expect(Number(stats["deduped"])).toBeGreaterThanOrEqual(1);

    // 6. Registration: extracted − merged = registered, never zero.
    expect(Number(stats["registered"])).toBe(Number(stats["extracted"]) - Number(stats["deduped"]));
    expect(Number(stats["registered"])).toBeGreaterThan(0);
    expect(stats["error"]).toBeNull();

    // 8. Every registered claim was evaluated.
    expect(Number(stats["verified"])).toBeGreaterThan(0);

    const claims = data["claims"] as unknown[];
    expect(claims.length).toBe(Number(stats["registered"]));
    const rows = claims.map((claim) => payload(claim));
    expect(rows.every((row) => typeof row["claim"] === "string" && row["claim"] !== "")).toBe(true);
    expect(rows.every((row) => row["status"] !== "unverified")).toBe(true);
    expect(rows.every((row) => typeof row["reason"] === "string" && row["reason"] !== "")).toBe(
      true,
    );

    // Evidence vs claim: a name in the deck is not proof, and the stack is.
    const face = rows.find((row) => /face verification/i.test(String(row["claim"])));
    expect(face?.["status"]).toBe("unsupported");
    const react = rows.find((row) => row["claim"] === "React");
    expect(react?.["status"]).toBe("supported");

    // 7. Debug lines for the pipeline.
    const log = stats["log"] as string[];
    expect(log.some((line) => line.startsWith("[PPT] extracted"))).toBe(true);
    expect(log.some((line) => line.startsWith("[README] extracted"))).toBe(true);
    expect(log.some((line) => line.startsWith("[DEDUPLICATION]"))).toBe(true);
    expect(log.some((line) => line.startsWith("[REGISTERED]"))).toBe(true);
    expect(log.some((line) => line.startsWith("[VERIFICATION]"))).toBe(true);
  });

  it("merges one claim found in both sources into a single row with both locations", () => {
    const { claims, stats } = registerClaims({
      document: DECK,
      readme: { path: "README.md", text: README },
      signals: {
        filePaths: ["src/app.tsx", "package.json"],
        frameworks: ["React"],
        languages: ["TypeScript"],
        readmeText: README,
        liveEvidence: [],
      },
    });

    const merged = claims.filter((claim) => claim.claim === "Document upload for ID cards");
    expect(merged).toHaveLength(1);
    expect(merged[0]?.sources.map((source) => source.source)).toEqual(["PPT", "README"]);
    expect(stats.deduped).toBeGreaterThanOrEqual(1);
    expect(claims.some((claim) => claim.sourceLocation?.startsWith("Slide"))).toBe(true);
    expect(claims.some((claim) => claim.sourceLocation?.startsWith("README.md"))).toBe(true);
  });

  it("is deterministic: the same evidence produces the same claims and score", async () => {
    const first = await runProjectAnalysis({
      input: inputWith(DECK),
      persistence: persistence(),
      fetchImpl: fetchWithReadme().fetchImpl,
    });
    const second = await runProjectAnalysis({
      input: inputWith(DECK),
      persistence: persistence(),
      fetchImpl: fetchWithReadme().fetchImpl,
    });

    expect(payload(second.reportData)["claims"]).toEqual(payload(first.reportData)["claims"]);
    expect(payload(second.reportData)["claim_counts"]).toEqual(
      payload(first.reportData)["claim_counts"],
    );
    expect(second.score).toBe(first.score);
  });

  it("stops the report when claims were extracted but none were registered", () => {
    expect(claimRegistrationError(5, 0)).toBe(
      "Claims were extracted but were not registered for verification.",
    );
    expect(claimRegistrationError(5, 5)).toBeNull();
    expect(claimRegistrationError(0, 0)).toBeNull();
  });
});

describe("claim scoring", () => {
  it("fills the evidence score and pulls the overall score down for unsupported claims", async () => {
    const run = await runProjectAnalysis({
      input: inputWith(DECK),
      persistence: persistence(),
      fetchImpl: fetchWithReadme().fetchImpl,
    });

    const data = payload(run.reportData);
    const scores = payload(data["scores"]);
    const evidence = scores["evidence"];
    expect(typeof evidence).toBe("number");
    expect(Number(evidence)).toBeGreaterThanOrEqual(0);
    expect(Number(evidence)).toBeLessThanOrEqual(100);
    expect(Number(evidence)).toBeLessThan(100);

    // Claims that the evidence cannot back must lower the overall score…
    const breakdown = payload(data["score_breakdown"]);
    const repositoryScore = Number(breakdown["overall"]);
    const stats = payload(data["claim_pipeline"]);
    const deduction = Number(stats["deduction"]);
    expect(deduction).toBeLessThan(0);
    expect(run.score).toBe(repositoryScore + deduction);
    expect(run.score as number).toBeLessThan(repositoryScore);

    // …but bounded, so a claim set can never erase the whole report.
    expect(deduction).toBeGreaterThanOrEqual(-40);
    expect(claimScoreDeduction([])).toBe(0);

    // The registered claims are what produce such a number.
    const claims = registerClaims({
      document: DECK,
      readme: { path: "README.md", text: README },
      signals: {
        filePaths: ["src/app.tsx", "package.json"],
        frameworks: ["React"],
        languages: ["TypeScript"],
        readmeText: README,
        liveEvidence: [],
      },
    }).claims;
    const directScore = computeEvidenceScore(claims);
    expect(directScore).not.toBeNull();
    expect(directScore as number).toBeGreaterThanOrEqual(0);
    expect(claimScoreDeduction(claims)).toBeLessThan(0);
  });

  it("returns no evidence score when there are no claims", () => {
    expect(computeEvidenceScore([])).toBeNull();
  });
});

describe('the report never says "No claims recorded" for a claimful submission', () => {
  it("normalizes registered claims into the view the report renders", async () => {
    const { fetchImpl } = fetchWithReadme();
    const result = await runProjectAnalysis({
      input: inputWith(DECK),
      persistence: persistence(),
      fetchImpl,
    });

    const view = normalizeReportData(result.reportData);

    expect(view.claims.length).toBeGreaterThan(0);
    expect(view.claimCounts.total).toBe(view.claims.length);
    expect(view.claimCounts.supported + view.claimCounts.partial).toBeGreaterThan(0);
    expect(view.claimPipeline).not.toBeNull();
    expect(view.claimPipeline?.error).toBeNull();
    expect(view.claimPipeline?.extracted).toBeGreaterThan(0);
    expect(typeof view.scores.evidence).toBe("number");
  });
});
