/**
 * Judge copilot: evidence-based questions, candidate-safe suggestions, and the
 * state that has to survive a refresh.
 *
 * The rules under test:
 *   • every generated question quotes the evidence behind it;
 *   • nothing is asked when there is nothing to ask — no invented questions;
 *   • suggestions are actionable and never carry judge-only information;
 *   • asked / answered / notes persist, and judge-written questions are kept.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { normalizeReportData, type ReportView } from "@/lib/report-data";
import {
  buildImprovementSuggestions,
  buildJudgeQuestions,
  mergeQuestionState,
} from "@/services/inspection/copilot";
import { listEvaluations, saveEvaluation } from "@/services/judging/evaluations.service";
import { LOCAL_JUDGE_ID } from "@/services/judging/store";
import { defaultCriteriaSet } from "@/lib/evaluation/criteria";
import type { JudgeQuestion, JudgeReview } from "@/types/evaluation";

/* --------------------------------------------------------------- fixtures */

function view(overrides: Record<string, unknown> = {}): ReportView {
  return normalizeReportData({
    executive_summary: "An extension that tailors CVs locally.",
    overview: {
      summary: "CV tailoring browser extension",
      highlights: ["Uses a local model"],
      techStack: ["TypeScript"],
      repoUrl: "https://github.com/codexcapsules/extension",
      websiteUrl: null,
    },
    claims: [
      {
        claim: "Local CV processing",
        verified: false,
        evidence: "No matching implementation was found in the repository.",
        source: "PPT",
        sourceLocation: "Slide 5",
        status: "not_found",
      },
      {
        claim: "Browser extension",
        verified: true,
        evidence: "Found in manifest.json",
        source: "PPT",
        sourceLocation: "Slide 4",
        status: "supported",
      },
    ],
    performance: {
      summary: "Measured in the browser",
      vitals: [{ name: "lcp", value: 4.2, unit: "s", threshold: 2.5, good: false }],
    },
    security: {
      summary: "Public sources only",
      findings: [
        {
          title: "Potential API key exposure",
          detail: "An API-key-like string is committed in src/config.ts.",
          severity: "critical",
        },
      ],
    },
    repository: {
      url: "https://github.com/codexcapsules/extension",
      hasTests: false,
      hasCI: false,
    },
    ...overrides,
  });
}

/* ---------------------------------------------------------------- questions */

describe("questions to ask", () => {
  it("turns an unverified claim into a question that quotes its evidence", () => {
    const questions = buildJudgeQuestions(view());
    const claimQuestion = questions.find((question) => question.category === "claim");
    expect(claimQuestion).toBeDefined();
    expect(claimQuestion?.question).toContain("Local CV processing");
    expect(claimQuestion?.evidence).toContain("Slide 5");
    expect(claimQuestion?.priority).toBe("high");
    expect(claimQuestion?.source).toBe("evidence");
    expect(claimQuestion?.status).toBe("pending");
  });

  it("asks about a measured performance problem instead of inventing one", () => {
    const questions = buildJudgeQuestions(view());
    const performance = questions.find((question) => question.category === "performance");
    expect(performance?.question).toMatch(/LCP/);
    expect(performance?.question).toContain("4.2");
  });

  it("asks about a critical security finding", () => {
    const questions = buildJudgeQuestions(view());
    const security = questions.find((question) => question.category === "security");
    expect(security).toBeDefined();
    expect(security?.question).toMatch(/API key exposure/i);
    expect(security?.evidence).toMatch(/api-key-like string is committed/i);
  });

  it("never asks about candidate metadata", () => {
    const questions = buildJudgeQuestions(
      view({
        claims: [
          { claim: "Team ID - 176743", verified: false, source: "PPT", sourceLocation: "Slide 1" },
          { claim: "GOES TO", verified: false, source: "PPT", sourceLocation: "Slide 3" },
        ],
      }),
    );
    const text = questions.map((question) => question.question).join(" ");
    expect(text).not.toMatch(/176743|GOES TO/);
  });

  it("returns nothing when nothing needs asking", () => {
    const clean = view({
      claims: [{ claim: "Browser extension", verified: true, evidence: "manifest.json" }],
      performance: { summary: null, vitals: [] },
      security: { summary: null, findings: [] },
      repository: { url: "https://github.com/x/y", hasTests: true },
    });
    expect(buildJudgeQuestions(clean)).toHaveLength(0);
  });

  it("never returns more than five questions", () => {
    const many = view({
      claims: Array.from({ length: 8 }, (_, index) => ({
        claim: `Claim number ${index}`,
        verified: false,
        status: "not_found",
        evidence: "Not found",
      })),
    });
    expect(buildJudgeQuestions(many).length).toBeLessThanOrEqual(5);
  });
});

/* -------------------------------------------------------------- suggestions */

describe("candidate-safe suggestions", () => {
  it("explains each suggestion as problem, why and what to do", () => {
    const suggestions = buildImprovementSuggestions(view());
    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      expect(suggestion.problem.length).toBeGreaterThan(0);
      expect(suggestion.why.length).toBeGreaterThan(0);
      expect(suggestion.recommendation.length).toBeGreaterThan(0);
    }
  });

  it("covers unverified claims, security and performance without judge notes", () => {
    const suggestions = buildImprovementSuggestions(view());
    expect(suggestions.some((entry) => entry.area === "Claim clarity")).toBe(true);
    expect(suggestions.some((entry) => entry.area === "Security")).toBe(true);
    expect(suggestions.some((entry) => entry.area === "Performance")).toBe(true);

    const text = JSON.stringify(suggestions).toLowerCase();
    expect(text).not.toMatch(/judge score|private note|recommendation:/);
  });
});

/* ------------------------------------------------------------ merge & state */

describe("question state survives a refresh", () => {
  const generated = buildJudgeQuestions(view());

  it("keeps asked/answered status and notes from storage", () => {
    const stored: JudgeQuestion[] = generated.map((question, index) =>
      index === 0 ? { ...question, status: "answered", note: "They demoed it." } : question,
    );
    const merged = mergeQuestionState(generated, stored);
    expect(merged[0]?.status).toBe("answered");
    expect(merged[0]?.note).toBe("They demoed it.");
  });

  it("keeps a judge-written question that the generator does not produce", () => {
    const custom: JudgeQuestion = {
      id: "judge.abc",
      category: "product",
      question: "Where does the local CV parsing run?",
      why: "Added by the judge.",
      evidence: "Judge-authored question.",
      priority: "medium",
      source: "judge",
      status: "asked",
      note: null,
    };
    const merged = mergeQuestionState(generated, [...generated, custom]);
    expect(merged.some((question) => question.id === "judge.abc")).toBe(true);
  });
});

/* ------------------------------------------------------------- persistence */

describe("review persistence", () => {
  const criteria = defaultCriteriaSet("project");

  beforeEach(() => {
    window.localStorage.clear();
  });

  const review: JudgeReview = {
    assessment: "Strong prototype, one unproven claim.",
    strengths: ["Working extension"],
    weaknesses: ["Local CV not found"],
    suggestions: ["Add a demo of the local processing"],
    concerns: ["Key exposure mentioned in the analysis"],
    recommendation: "maybe",
    updatedAt: "2026-02-01T00:00:00.000Z",
  };

  it("stores questions and the review with the evaluation and reads them back", async () => {
    await saveEvaluation({
      submissionId: "project:test-1",
      category: "project",
      judgeId: LOCAL_JUDGE_ID,
      judgeName: "You",
      scores: [],
      recommendation: "maybe",
      note: null,
      criteria,
      status: "in_progress",
      questions: buildJudgeQuestions(view()).map((question) => ({
        ...question,
        status: "asked" as const,
      })),
      review,
    });

    const [record] = await listEvaluations("project", LOCAL_JUDGE_ID);
    expect(record?.questions?.length).toBeGreaterThan(0);
    expect(record?.questions?.[0]?.status).toBe("asked");
    expect(record?.review?.assessment).toBe(review.assessment);
    expect(record?.review?.recommendation).toBe("maybe");
  });

  it("does not wipe the review when only the scores change", async () => {
    await saveEvaluation({
      submissionId: "project:test-2",
      category: "project",
      judgeId: LOCAL_JUDGE_ID,
      judgeName: "You",
      scores: [],
      recommendation: "maybe",
      note: null,
      criteria,
      status: "in_progress",
      review,
    });

    await saveEvaluation({
      submissionId: "project:test-2",
      category: "project",
      judgeId: LOCAL_JUDGE_ID,
      judgeName: "You",
      scores: [{ criterionId: "problem", awarded: 8, note: null }],
      recommendation: "yes",
      note: null,
      criteria,
      status: "evaluated",
    });

    const record = (await listEvaluations("project", LOCAL_JUDGE_ID)).find(
      (entry) => entry.submissionId === "project:test-2",
    );
    expect(record?.review?.assessment).toBe(review.assessment);
    expect(record?.recommendation).toBe("yes");
  });
});
