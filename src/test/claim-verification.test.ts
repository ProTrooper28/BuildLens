/**
 * The evaluation must answer one question above all others: does what the team
 * CLAIMED match what they BUILT?
 *
 * These tests use the bad example the brief describes — a deck that pitches a
 * face-verification product while the repository and deployment are a different
 * project — and check that the pipeline actually reacts:
 *
 *   · the document/implementation mismatch is detected and caps the score
 *   · unsupported claims and features drag the claim score down
 *   · a missing SECURITY.md never outweighs an exposed credential
 *   · performance is reported only when it was measured
 *   · the same evidence always produces the same score
 */

import { describe, expect, it } from "vitest";

import type {
  ClaimCheck,
  ClaimEvidenceStatus,
  EvidenceBundle,
  EvidenceObservation,
  EvidenceSourceReport,
} from "@/services/evidence/types";
import { CLAIM_STATUS_DISCLAIMER } from "@/services/evidence/types";
import { buildInspectionReport } from "@/services/inspection";
import type { ProjectDetail } from "@/types/evaluation";

const REPO = "https://github.com/team/mediscan";
const DEMO = "https://mediscan.app";

const detail: ProjectDetail = {
  id: "project:bad",
  category: "project",
  source: "workspace",
  name: "MediScan",
  subtitle: null,
  description: "Clinic intake tool.",
  tags: [],
  yearsExperience: null,
  projectCategory: "Submitted",
  createdAt: "2026-03-01T00:00:00.000Z",
  team: "Team MediScan",
  problemStatement: "Clinics lose time on paper intake.",
  solution: "A small intake dashboard.",
  technologies: ["React"],
  repoUrl: REPO,
  demoUrl: DEMO,
  media: [],
  teamMembers: [],
  submitted: [],
  presentationClaims: {
    summary: `MediScan by Team FaceShield. Reference implementation: github.com/team/faceshield. Live demo: https://faceshield-demo.com`,
    features: [
      "Real-time face verification for patient check-in",
      "AI triage chatbot that speaks Kiswahili",
      "CSV export of the daily report",
    ],
    technology: ["TensorFlow", "FastAPI"],
    impact: ["Used by 12 clinics in Nairobi"],
    method: "heuristic",
  },
  presentationPages: [
    {
      page: 2,
      text: "FaceShield verifies a patient's identity from a photo before the consultation begins.",
    },
  ],
};

function observation(
  overrides: Partial<EvidenceObservation> & { id: string },
): EvidenceObservation {
  return {
    area: "repository",
    label: overrides.id,
    status: "good",
    result: "",
    evidence: [],
    confidence: "high",
    ...overrides,
  };
}

function source(
  overrides: Partial<EvidenceSourceReport> & { kind: EvidenceSourceReport["kind"] },
): EvidenceSourceReport {
  return {
    label: overrides.kind,
    status: "ingested",
    readable: true,
    url: null,
    detail: "Read.",
    highlights: [],
    ...overrides,
  };
}

function claim(
  overrides: Partial<ClaimCheck> & Pick<ClaimCheck, "id" | "claim" | "status">,
): ClaimCheck {
  return {
    category: "features",
    sources: ["repository"],
    quotes: [],
    note: "",
    ...overrides,
  };
}

const deckSources = [
  source({ kind: "document", label: "Presentation", url: "deck.pdf" }),
  source({
    kind: "repository",
    label: "GitHub repository",
    url: REPO,
    highlights: ["Frameworks detected: React.", "TypeScript 82%"],
    observations: [
      observation({
        id: "repo.quality",
        label: "Code quality",
        result: "78/100 — organised, small modules.",
      }),
      observation({
        id: "repo.maintainability",
        label: "Maintainability",
        result: "81/100 — no duplicated blocks found.",
      }),
      observation({
        id: "repo.code.tests",
        label: "Tests",
        status: "warning",
        result: "No test files were found.",
      }),
      observation({
        id: "repo.code.docs",
        label: "Documentation",
        result: "A README documents the project.",
      }),
      observation({
        id: "repo.security.secrets",
        label: "Secrets and sensitive files",
        status: "not_detected",
        result: "No committed-secret or sensitive-file pattern was detected.",
      }),
      observation({
        id: "repo.security.server_side",
        label: "Server-side security",
        status: "could_not_verify",
        result: "Not audited.",
      }),
    ],
  }),
  source({
    kind: "website",
    label: "Deployed application",
    url: DEMO,
    highlights: ["HTTP 200", "React app"],
    observations: [
      observation({
        id: "site.performance.response",
        area: "performance",
        label: "Time to first response",
        result: "Page responded in 420ms.",
        evidence: ["HTTP 200 in 420ms"],
      }),
      observation({
        id: "site.security.headers",
        area: "security",
        label: "Security headers",
        status: "warning",
        result: "Some recommended headers were not sent.",
        evidence: ["content-security-policy: not sent", "x-frame-options: not sent"],
      }),
      observation({
        id: "site.functionality.routes",
        area: "functionality",
        label: "Routes served",
        result: "3 routes were served: /, /intake, /reports",
      }),
      observation({
        id: "site.security.server_side",
        area: "security",
        label: "Server-side security",
        status: "could_not_verify",
        result: "Not audited.",
      }),
    ],
  }),
];

/** A deck pitching face verification, and a repo that does not contain it. */
function mismatchedBundle(
  extra: {
    claims?: ClaimCheck[];
    repoSecrets?: EvidenceObservation;
    withPerformance?: boolean;
  } = {},
): EvidenceBundle {
  const claims: ClaimCheck[] = extra.claims ?? [
    claim({
      id: "deck.feature.0",
      claim: "Real-time face verification for patient check-in",
      kind: "ai",
      status: "not_found",
      sources: ["repository", "website"],
      evidenceRefs: ["GitHub: searched src/, package.json", "Deployed page: searched /"],
      pageRefs: [2],
      note: "No matching implementation, route or deployed feature was found.",
    }),
    claim({
      id: "deck.feature.1",
      claim: "AI triage chatbot that speaks Kiswahili",
      kind: "ai",
      status: "not_found",
      sources: ["repository", "website"],
      evidenceRefs: ["GitHub: searched src/", "Deployed page: searched /"],
      note: "No matching implementation was found.",
    }),
    claim({
      id: "deck.feature.2",
      claim: "CSV export of the daily report",
      kind: "functionality",
      status: "supported",
      sources: ["repository"],
      evidenceRefs: ["GitHub: src/reports/csv.ts"],
      note: "The repository contains this implementation.",
    }),
    claim({
      id: "deck.impact.0",
      claim: "Used by 12 clinics in Nairobi",
      category: "impact",
      kind: "general",
      status: "could_not_verify",
      sources: [],
      note: "No usage data was provided.",
    }),
  ];

  const sources = deckSources.map((entry) => {
    if (entry.kind === "repository" && extra.repoSecrets) {
      return {
        ...entry,
        observations: [
          extra.repoSecrets,
          ...(entry.observations ?? []).filter((obs) => obs.id !== "repo.security.secrets"),
        ],
      };
    }
    if (entry.kind === "website" && extra.withPerformance === false) {
      return {
        ...entry,
        observations: (entry.observations ?? []).filter(
          (obs) => obs.id !== "site.performance.response",
        ),
      };
    }
    return entry;
  });

  const counts: Record<ClaimEvidenceStatus, number> = {
    supported: 0,
    partially_supported: 0,
    not_found: 0,
    could_not_verify: 0,
  };
  for (const entry of claims) counts[entry.status] += 1;

  return {
    generatedAt: "2026-03-01T00:00:00.000Z",
    sources,
    claims,
    gaps: [],
    counts,
    disclaimer: CLAIM_STATUS_DISCLAIMER,
  };
}

describe("claim verification pipeline", () => {
  it("detects that the deck describes a different project and caps the score", () => {
    const report = buildInspectionReport({ detail, bundle: mismatchedBundle(), evaluation: null });

    expect(report.mismatch.level).toBe("major");
    expect(report.mismatch.signals.some((signal) => signal.id === "repo-link")).toBe(true);
    expect(report.mismatch.evidence.join(" ")).toContain("github.com/team/faceshield");

    const documentSection = report.sections.find((section) => section.id === "document");
    const mismatchCheck = documentSection?.checks.find((check) => check.id === "document.mismatch");
    expect(mismatchCheck?.status).toBe("critical");

    expect(report.verdict.mismatch.level).toBe("major");
    expect(report.verdict.breakdown.caps.some((cap) => cap.cap === 45)).toBe(true);
    expect(report.verdict.overallScore).not.toBeNull();
    expect(report.verdict.overallScore as number).toBeLessThanOrEqual(45);
    expect(report.verdict.executiveSummary).toMatch(/document describes a different product/i);
  });

  it("marks an unbuilt claimed feature as not supported, with evidence", () => {
    const report = buildInspectionReport({ detail, bundle: mismatchedBundle(), evaluation: null });
    const face = report.features.find((feature) => /face verification/i.test(feature.feature));

    expect(face).toBeDefined();
    expect(face?.result).toBe("not_supported");
    expect(face?.found).toBe(false);
    expect(face?.tested).toBe(false);
    expect(face?.severity).toBe("high");
    expect(face?.note).toMatch(/no matching implementation/i);
    // The name appearing in the deck is never enough on its own.
    expect(face?.evidence.join(" ")).not.toMatch(/deck/i);

    const claimDimension = report.verdict.breakdown.dimensions.find(
      (dimension) => dimension.id === "claimVerification",
    );
    expect(claimDimension?.score).not.toBeNull();
    expect(claimDimension?.score as number).toBeLessThan(40);
  });

  it("reports performance only when it was measured", () => {
    const measured = buildInspectionReport({
      detail,
      bundle: mismatchedBundle(),
      evaluation: null,
    });
    const measuredDimension = measured.verdict.breakdown.dimensions.find(
      (dimension) => dimension.id === "performance",
    );
    expect(measuredDimension?.basis).toBe("measured");
    expect(measuredDimension?.score).not.toBeNull();

    const unmeasured = buildInspectionReport({
      detail,
      bundle: mismatchedBundle({ withPerformance: false }),
      evaluation: null,
    });
    const unmeasuredDimension = unmeasured.verdict.breakdown.dimensions.find(
      (dimension) => dimension.id === "performance",
    );
    expect(unmeasuredDimension?.score).toBeNull();
    expect(unmeasuredDimension?.reason).toMatch(/no response time was measured/i);
  });

  it("never lets a missing SECURITY.md outweigh an exposed credential", () => {
    const policyOnly = buildInspectionReport({
      detail,
      bundle: mismatchedBundle({
        repoSecrets: observation({
          id: "repo.security.secrets",
          label: "Secrets and sensitive files",
          status: "warning",
          result: "1 repository security finding detected in committed files.",
          evidence: [
            "No security policy (SECURITY.md) (low) — There is no documented way to report a vulnerability.",
          ],
        }),
      }),
      evaluation: null,
    });

    expect(policyOnly.security.findings.some((finding) => finding.kind === "exposure")).toBe(false);
    expect(policyOnly.security.score as number).toBeGreaterThanOrEqual(95);
    expect(policyOnly.verdict.breakdown.caps.some((cap) => cap.cap === 60)).toBe(false);

    const exposed = buildInspectionReport({
      detail,
      bundle: mismatchedBundle({
        repoSecrets: observation({
          id: "repo.security.secrets",
          label: "Secrets and sensitive files",
          status: "critical",
          result: "1 repository security finding detected in committed files.",
          evidence: ["Environment file (.env) (critical) — Detected at `.env`."],
        }),
      }),
      evaluation: null,
    });

    const exposure = exposed.security.findings.find((finding) => finding.kind === "exposure");
    expect(exposure?.severity).toBe("critical");
    expect(exposed.security.counts.critical).toBe(1);
    expect(exposed.security.score as number).toBeLessThan(policyOnly.security.score as number);
    expect(exposed.verdict.breakdown.caps.some((cap) => cap.cap === 60)).toBe(true);
    expect(exposed.verdict.overallScore as number).toBeLessThanOrEqual(60);
    // The finding names the file, never the value behind it.
    expect(exposure?.detail).not.toMatch(/=|:[A-Za-z0-9_-]{16,}/);
  });

  it("is deterministic: the same evidence produces the same verdict", () => {
    const first = buildInspectionReport({ detail, bundle: mismatchedBundle(), evaluation: null });
    const second = buildInspectionReport({ detail, bundle: mismatchedBundle(), evaluation: null });

    expect(second.verdict.overallScore).toBe(first.verdict.overallScore);
    expect(second.verdict.breakdown).toEqual(first.verdict.breakdown);
    expect(second.features).toEqual(first.features);
    expect(second.mismatch).toEqual(first.mismatch);
  });

  it("does not penalise a project whose claims are backed by what was built", () => {
    const supported: ClaimCheck[] = [
      claim({
        id: "deck.feature.0",
        claim: "CSV export of the daily report",
        kind: "functionality",
        status: "supported",
        sources: ["repository", "website"],
        evidenceRefs: ["GitHub: src/reports/csv.ts", "Deployed page: /reports"],
        note: "Found in the implementation and on the deployed page.",
      }),
      claim({
        id: "deck.feature.1",
        claim: "Clinic intake form",
        kind: "functionality",
        status: "supported",
        sources: ["repository", "website"],
        evidenceRefs: ["GitHub: src/intake/form.tsx", "Deployed page: /intake"],
        note: "Found in the implementation and on the deployed page.",
      }),
    ];

    const report = buildInspectionReport({
      detail: { ...detail, presentationClaims: null, presentationPages: null },
      bundle: mismatchedBundle({ claims: supported }),
      evaluation: null,
    });

    expect(report.mismatch.level).toBe("none");
    expect(report.verdict.breakdown.caps).toHaveLength(0);
    expect(report.verdict.overallScore as number).toBeGreaterThanOrEqual(65);
    expect(report.features.every((feature) => feature.result === "supported")).toBe(true);
    expect(
      report.verdict.keyConcerns.filter(
        (concern) => concern.severity === "critical" || concern.severity === "high",
      ),
    ).toHaveLength(0);
  });
});
