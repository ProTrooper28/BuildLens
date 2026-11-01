/**
 * The report's information architecture is derived, not hand-written: these
 * tests pin the structure (summary, findings, claim table, sections) and the
 * honesty rules (an unmeasured metric is never given a number).
 */

import { describe, expect, it } from "vitest";

import type { Json } from "@/types/database";
import { normalizeReportData } from "@/lib/report-data";
import { buildReportInsights } from "@/lib/report-insights";

const PAYLOAD = {
  scores: {
    overall: 72,
    evidence: 58,
    codeQuality: 80,
    security: 55,
    maintainability: 70,
    testing: 40,
    documentation: 60,
  },
  overview: { techStack: ["React", "TypeScript"], repoUrl: "https://github.com/acme/app" },
  claims: [
    {
      claim: "Real-time analytics dashboard",
      status: "supported",
      category: "feature",
      source: "PPT",
      source_location: "Slide 3",
      evidence: "Found src/pages/dashboard.tsx",
      reason: "A matching implementation file was found.",
      sources: [{ source: "PPT", location: "Slide 3" }],
    },
    {
      claim: "Face recognition login",
      status: "unsupported",
      category: "feature",
      source: "PPT",
      source_location: "Slide 4",
      evidence: "Searched 42 repository paths and the README.",
      reason: "No matching route, component, file or documentation was found after inspection.",
      sources: [{ source: "PPT", location: "Slide 4" }],
    },
    {
      claim: "Runs on React",
      status: "supported",
      category: "technology",
      source: "README",
      evidence: "React detected in package.json",
      reason: "The framework is present in the repository.",
      sources: [{ source: "README", location: "README.md — Tech stack" }],
    },
  ],
  claim_pipeline: {
    deck: 2,
    readme: 1,
    repository: 0,
    extracted: 3,
    deduped: 0,
    registered: 3,
    verified: 3,
    error: null,
    log: [],
  },
  security: {
    summary: "One exposed key.",
    findings: [
      { title: "Committed .env file", severity: "critical", detail: "services/.env is tracked." },
    ],
  },
  risks: [],
  documentation: { summary: "README present.", notes: ["README.md documents setup."] },
  testing: { summary: "2 test files using Vitest.", notes: [] },
  evidence: {
    repository: "acme/app",
    repository_url: "https://github.com/acme/app",
    files_listed: 42,
    readme: "README.md",
    test_files: 2,
    inspected_at: "2026-01-01T00:00:00.000Z",
  },
  website: { url: "https://acme.example.com" },
  recommendations: [{ title: "Split the bundle", priority: "medium" }],
};

function insightsOf(payload: unknown) {
  return buildReportInsights(normalizeReportData(payload as Json));
}

describe("report insights", () => {
  it("derives the verdict, summary and top findings from the claims", () => {
    const insights = insightsOf(PAYLOAD);

    expect(insights.verdict.label).toBe("PARTIALLY VERIFIED");
    expect(insights.verdict.tone).toBe("partial");

    // 2 of 3 claims backed (one only counts half) — stated with real numbers.
    expect(insights.summary[0]).toContain("2 of 3");
    // The analysis never executed the site, so performance is reported as a gap.
    expect(insights.summary.join(" ")).toMatch(/Performance was not measured/);

    // Critical findings lead; nothing is duplicated and the list stays short.
    expect(insights.findings.length).toBeLessThanOrEqual(5);
    expect(insights.findings[0]?.tone).toBe("critical");
    const rank = { critical: 0, important: 1, positive: 2 } as const;
    const ranks = insights.findings.map((finding) => rank[finding.tone]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(insights.findings.map((finding) => finding.title)).size).toBe(
      insights.findings.length,
    );
  });

  it("builds the claim table with repository marks and untested deployment", () => {
    const insights = insightsOf(PAYLOAD);
    const byClaim = (text: string) => insights.claims.find((entry) => entry.claim.claim === text);

    expect(insights.claims).toHaveLength(3);
    expect(byClaim("Real-time analytics dashboard")?.repository).toBe("verified");
    expect(byClaim("Face recognition login")?.repository).toBe("not_found");
    expect(byClaim("Face recognition login")?.verdict.label).toBe("Unsupported");
    expect(byClaim("Runs on React")?.sourceLabel).toBe("README");
    // Deployment is never claimed as verified: the app was not executed.
    expect(insights.claims.every((entry) => entry.deployment === "not_tested")).toBe(true);
  });

  it("keeps unmeasured metrics unmeasured and reports the performed checks", () => {
    const insights = insightsOf(PAYLOAD);
    const lcp = insights.performance.find((metric) => metric.name === "LCP");
    expect(lcp?.status).toBe("not_measured");
    expect(lcp?.value).toBeNull();

    const runtime = insights.evidenceSources.find((source) => source.key === "runtime");
    expect(runtime?.available).toBeNull();
    expect(runtime?.detail).toMatch(/Not performed/i);

    const repository = insights.evidenceSources.find((source) => source.key === "repository");
    expect(repository?.available).toBe(true);
    expect(repository?.detail).toContain("42 files listed");
  });

  it("orders recommendations by priority and caps the list", () => {
    const insights = insightsOf(PAYLOAD);
    expect(insights.recommendations[0]?.priority).toBe("critical");
    expect(insights.recommendations.length).toBeLessThanOrEqual(6);
    expect(insights.recommendations.map((entry) => entry.title)).toContain("Split the bundle");
  });

  it("falls back to the stored score for payloads without a scoreboard", () => {
    const insights = insightsOf(PAYLOAD);
    expect(insights.finalVerdict.score).toBe(72);
    expect(insights.scoreboard.measuredMax).toBeGreaterThan(0);
    expect(insights.finalVerdict.concerns.length).toBeGreaterThan(0);
    expect(insights.finalVerdict.takeaway).toMatch(/not backed by the evidence|overstates/i);
  });

  it("shows deck claims that were never registered instead of hiding them", () => {
    const insights = insightsOf({
      scores: { overall: 40 },
      submission: {
        document_analysis: {
          status: "success",
          file_name: "deck.pptx",
          claims: {
            summary: "An app that predicts crop yield.",
            problem: [],
            solution: [],
            features: ["Yield prediction per field"],
            technology: [],
            impact: [],
          },
        },
      },
    });

    expect(insights.claimCounts.total).toBe(2);
    expect(insights.claims.every((entry) => entry.repository === "unverified")).toBe(true);
    expect(insights.claims.map((entry) => entry.claim.claim)).toContain(
      "Yield prediction per field",
    );
    expect(insights.verdict.tone).toBe("unknown");
  });

  it("says there is not enough evidence when no claims exist at all", () => {
    const insights = insightsOf({ scores: { overall: 55, codeQuality: 60 } });
    expect(insights.claimCounts.total).toBe(0);
    expect(insights.verdict.label).toBe("NOT ENOUGH EVIDENCE");
    expect(insights.claims).toHaveLength(0);
    expect(insights.finalVerdict.takeaway).toMatch(/could not be verified/i);
  });
});
