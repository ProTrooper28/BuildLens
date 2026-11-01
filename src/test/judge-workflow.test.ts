/**
 * Priority 5 — the judge half of the workflow, end to end.
 *
 * The analysis pipeline is covered by `evidence-flow.test.ts`; this file picks up
 * where that stops: the same evidence bundle becomes the project report the judge
 * reads, the judge's criteria/scores/comments are persisted, and the evaluation
 * survives a reload and still produces the same deterministic total and rank.
 *
 * It also pins the two reliability rules that matter most:
 *   • a source that could not be read never blocks scoring and never becomes a
 *     finding against the team;
 *   * a deck claim is never "verified" by the deck it came from.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { defaultCriteriaSet } from "@/lib/evaluation/criteria";
import {
  awardedTotal,
  buildRankedRows,
  criterionTargets,
  deriveSubmissionStatus,
  recordScore,
  round1,
} from "@/lib/evaluation/scoring";
import { saveEvaluation, listEvaluations } from "@/services/judging/evaluations.service";
import { LOCAL_JUDGE_ID, resetJudgingStorageState } from "@/services/judging/store";
import { buildInspectionReport } from "@/services/inspection";
import {
  CLAIM_STATUS_DISCLAIMER,
  type EvidenceBundle,
  type EvidenceObservation,
} from "@/services/evidence/types";
import type { CriterionScore, ProjectDetail, SubmissionSummary } from "@/types/evaluation";

const JUDGE = { id: LOCAL_JUDGE_ID, name: "You (this browser)" };
const CATEGORY = "project" as const;

const project: ProjectDetail = {
  id: "project:aquasense",
  category: "project",
  source: "workspace",
  name: "AquaSense",
  subtitle: null,
  description: "Smart irrigation for smallholder farmers.",
  tags: ["React"],
  yearsExperience: null,
  projectCategory: "Submitted",
  createdAt: "2026-02-01T00:00:00.000Z",
  team: "Team Aqua",
  problemStatement: "Farmers cannot see soil moisture in real time.",
  solution: "Low-cost IoT probes with an on-device model.",
  technologies: ["React", "TypeScript"],
  repoUrl: "https://github.com/acme/aquasense",
  demoUrl: "https://aquasense.example.com",
  media: [],
  teamMembers: [],
  submitted: [],
  presentationClaims: {
    summary: "AquaSense — Smart Irrigation",
    features: ["Google sign-in for farm managers"],
    impact: ["Reduced water usage by 30%"],
  },
};

function obs(overrides: Partial<EvidenceObservation> & { id: string }): EvidenceObservation {
  return {
    area: "repository",
    label: "Check",
    status: "good",
    result: "The check ran.",
    evidence: [],
    confidence: "high",
    ...overrides,
  };
}

function bundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    generatedAt: "2026-02-01T00:00:00.000Z",
    sources: [
      {
        kind: "submission",
        label: "Submission form",
        status: "ingested",
        readable: true,
        url: null,
        detail: "The team's own submission text and deck (aquasense.pptx).",
        highlights: ["Declared technologies: React, TypeScript."],
      },
      {
        kind: "repository",
        label: "GitHub repository",
        status: "ingested",
        readable: true,
        url: "https://github.com/acme/aquasense",
        detail: "Repository acme/aquasense was inspected.",
        highlights: ["Frameworks detected: React.", "Tests: 24 passing."],
        observations: [
          obs({
            id: "repo.code.auth",
            label: "Authentication implementation",
            result: "Authentication code was found (src/auth/session.ts).",
            evidence: ["src/auth/session.ts"],
          }),
          obs({
            id: "repo.code.tests",
            label: "Automated tests",
            result: "24 test files were found.",
            evidence: ["src/auth/session.test.ts"],
          }),
        ],
      },
      {
        kind: "website",
        label: "Deployed website",
        status: "ingested",
        readable: true,
        url: "https://aquasense.example.com/",
        detail: "The deployed page returned HTTP 200.",
        highlights: ["HTTP 200 in 420ms."],
        observations: [
          obs({
            id: "site.accessibility.reachable",
            area: "accessibility",
            label: "Deployed site reachable",
            result: "The deployed site answered the request and served a page.",
            evidence: ["HTTP 200 in 420ms"],
          }),
          obs({
            id: "site.security.server_side",
            area: "security",
            label: "Server-side vulnerabilities",
            status: "could_not_verify",
            result: "Server-side security cannot be verified from a public page load.",
            evidence: [],
          }),
        ],
      },
      {
        kind: "document",
        label: "Submitted deck",
        status: "ingested",
        readable: true,
        url: null,
        detail: "Presentation text extracted (5 pages, native text).",
        highlights: ["5 pages with text"],
      },
    ],
    claims: [
      {
        id: "deck.features.0",
        claim: "Google sign-in for farm managers",
        category: "features",
        status: "supported",
        sources: ["repository", "website"],
        quotes: ["Authentication code was found (src/auth/session.ts)."],
        note: "The repository contains the authentication flow this claim describes.",
        kind: "features",
        pageRefs: [3],
        evidenceRefs: [
          "GitHub: src/auth/session.ts",
          "Deployed page: https://aquasense.example.com/",
        ],
      },
      {
        id: "deck.impact.0",
        claim: "Reduced water usage by 30%",
        category: "impact",
        status: "could_not_verify",
        sources: [],
        quotes: [],
        note: "Could not verify: no source with usage data was provided.",
        kind: "general",
        pageRefs: [5],
      },
    ],
    gaps: [],
    counts: { supported: 1, partially_supported: 0, not_found: 0, could_not_verify: 1 },
    disclaimer: CLAIM_STATUS_DISCLAIMER,
    ...overrides,
  };
}

const targets = criterionTargets(defaultCriteriaSet(CATEGORY));

/** Award a fixed fraction of every criterion, rounded like the panel does. */
function scoresAt(fraction: number): CriterionScore[] {
  return targets.map((target) => ({
    criterionId: target.criterion.id,
    awarded: Math.round(target.points * fraction),
    note: null,
  }));
}

beforeEach(() => {
  window.localStorage.clear();
  resetJudgingStorageState();
});

describe("judge workflow", () => {
  it("keeps the evidence, the scores and the comments across a reload", async () => {
    const report = buildInspectionReport({ detail: project, bundle: bundle(), evaluation: null });

    // What the judge reads: the deck claim is supported, the impact claim is not
    // a failure, and the deployment was inspected.
    expect(report.verdict.counts.supported).toBe(1);
    expect(report.verdict.counts.could_not_verify).toBe(1);
    expect(report.verdict.deployment.applicable).toBe(true);
    expect(report.verdict.deployment.rows.find((row) => row.id === "availability")?.value).toBe(
      "Online",
    );

    const scores = scoresAt(0.6);
    const expectedTotal = awardedTotal(scores, targets);
    const saved = await saveEvaluation({
      submissionId: project.id,
      category: CATEGORY,
      judgeId: JUDGE.id,
      judgeName: JUDGE.name,
      scores,
      recommendation: "yes",
      note: { body: "Deck and repo agree; impact claim needs a demo.", visibility: "private" },
      criteria: defaultCriteriaSet(CATEGORY),
      status: "evaluated",
    });

    expect(recordScore(saved, defaultCriteriaSet(CATEGORY)).total).toBe(expectedTotal);

    // Reload: new page, same browser storage.
    resetJudgingStorageState();
    const afterReload = await listEvaluations(CATEGORY, JUDGE.id);
    expect(afterReload).toHaveLength(1);

    const record = afterReload[0]!;
    expect(record.id).toBe(saved.id);
    expect(record.status).toBe("evaluated");
    expect(record.recommendation).toBe("yes");
    expect(record.notes?.body).toBe("Deck and repo agree; impact claim needs a demo.");
    expect(record.scores).toEqual(scores);
    // Same deterministic total — the calculation never depends on render order.
    expect(recordScore(record, defaultCriteriaSet(CATEGORY)).total).toBe(expectedTotal);
    expect(deriveSubmissionStatus(afterReload)).toBe("evaluated");
  });

  it("updates the same record when the judge edits a score", async () => {
    const base = {
      submissionId: project.id,
      category: CATEGORY,
      judgeId: JUDGE.id,
      judgeName: JUDGE.name,
      recommendation: "yes" as const,
      note: { body: "First pass.", visibility: "private" as const },
      criteria: defaultCriteriaSet(CATEGORY),
    };

    const first = await saveEvaluation({ ...base, scores: scoresAt(0.4), status: "evaluated" });
    const second = await saveEvaluation({
      ...base,
      scores: scoresAt(0.75),
      note: { body: "Second pass after the demo.", visibility: "private" },
      status: "evaluated",
    });

    expect(second.id).toBe(first.id);
    expect(second.submittedAt).toBe(first.submittedAt);
    expect(recordScore(second, base.criteria).total).toBeGreaterThan(
      recordScore(first, base.criteria).total,
    );

    const records = await listEvaluations(CATEGORY, JUDGE.id);
    expect(records).toHaveLength(1);
    expect(records[0]?.notes?.body).toBe("Second pass after the demo.");
  });

  it("ranks the cohort deterministically from the saved evaluations", async () => {
    const criteria = defaultCriteriaSet(CATEGORY);
    const strong = { ...project, id: "project:strong", name: "Strong" };
    const weak = { ...project, id: "project:weak", name: "Weak" };

    for (const [detail, fraction] of [
      [strong, 0.9],
      [weak, 0.35],
    ] as const) {
      await saveEvaluation({
        submissionId: detail.id,
        category: CATEGORY,
        judgeId: JUDGE.id,
        judgeName: JUDGE.name,
        scores: scoresAt(fraction),
        recommendation: null,
        note: null,
        criteria,
        status: "evaluated",
      });
    }

    resetJudgingStorageState();
    const records = await listEvaluations(CATEGORY, JUDGE.id);
    const recordsBySubmission = new Map(
      [strong, weak].map((detail) => [
        detail.id,
        records.filter((record) => record.submissionId === detail.id),
      ]),
    );
    const summaries: SubmissionSummary[] = [strong, weak].map((detail) => ({
      id: detail.id,
      category: CATEGORY,
      source: detail.source,
      name: detail.name,
      subtitle: detail.subtitle,
      description: detail.description,
      tags: detail.tags,
      yearsExperience: null,
      projectCategory: detail.projectCategory,
      createdAt: detail.createdAt,
    }));

    const rows = buildRankedRows(summaries, recordsBySubmission, criteria, {
      judgeId: JUDGE.id,
    });

    expect(rows.map((row) => row.submission.name)).toEqual(["Strong", "Weak"]);
    expect(rows.map((row) => row.rank)).toEqual([1, 2]);
    expect(rows[0]?.aggregate.finalScore).toBe(round1(rows[0]!.aggregate.finalScore!));
    expect(rows[0]!.aggregate.finalScore!).toBeGreaterThan(rows[1]!.aggregate.finalScore!);
  });

  it("still lets the judge score when no source could be read", async () => {
    const unreadable = bundle({
      sources: [
        {
          kind: "repository",
          label: "GitHub repository",
          status: "failed",
          readable: false,
          url: "https://github.com/acme/private",
          detail: "The repository is private, so it could not be read.",
          highlights: [],
        },
        {
          kind: "website",
          label: "Deployed website",
          status: "failed",
          readable: false,
          url: "https://aquasense.example.com",
          detail: "aquasense.example.com did not answer the request (timeout).",
          highlights: [],
        },
      ],
      claims: bundle().claims.map((claim) => ({
        ...claim,
        status: "could_not_verify" as const,
        sources: [],
        quotes: [],
        evidenceRefs: [],
        note: "Could not verify: no source was readable, so this claim is unchecked — not contradicted.",
      })),
      gaps: ["Repository could not be read.", "Deployed site could not be read."],
      counts: { supported: 0, partially_supported: 0, not_found: 0, could_not_verify: 2 },
    });

    const report = buildInspectionReport({ detail: project, bundle: unreadable, evaluation: null });
    expect(report.verdict.tone).toBe("unverified");
    expect(report.verdict.counts.not_found).toBe(0);
    // Every section still renders, so the judge is never handed a blank page.
    expect(report.sections.every((section) => section.checks.length > 0)).toBe(true);
    expect(report.verdict.deployment.rows.find((row) => row.id === "availability")?.status).toBe(
      "could_not_verify",
    );

    const saved = await saveEvaluation({
      submissionId: project.id,
      category: CATEGORY,
      judgeId: JUDGE.id,
      judgeName: JUDGE.name,
      scores: scoresAt(0.5),
      recommendation: "maybe",
      note: { body: "Scored from the demo; both sources were unreadable.", visibility: "private" },
      criteria: defaultCriteriaSet(CATEGORY),
      status: "evaluated",
    });
    expect(saved.status).toBe("evaluated");
    expect(recordScore(saved, defaultCriteriaSet(CATEGORY)).total).toBe(
      awardedTotal(scoresAt(0.5), targets),
    );
  });

  it("does not treat the deck as proof of its own claims", () => {
    const report = buildInspectionReport({ detail: project, bundle: bundle(), evaluation: null });
    const claims = report.sections.find((section) => section.id === "claims")!;
    const deckClaim = claims.checks.find((check) => check.id === "claim:deck.features.0")!;

    const document = deckClaim.crossChecks?.find((check) => check.source === "Document");
    expect(document?.status).toBe("could_not_verify");
    expect(document?.detail).toMatch(/does not count as proof/i);

    // The code and the live app did carry it.
    expect(deckClaim.crossChecks?.find((check) => check.source === "Repository")?.status).toBe(
      "supported",
    );
    expect(deckClaim.crossChecks?.find((check) => check.source === "Deployment")?.status).toBe(
      "supported",
    );
  });
});
