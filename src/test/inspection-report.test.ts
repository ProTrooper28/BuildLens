/**
 * The judge report is what a judge reads first, so it has to be:
 *
 *   • honest   — “could not verify” never becomes a negative finding, and no
 *                score appears unless a model actually produced one;
 *   • complete — a project type that has no website is not treated as a failure;
 *   • grounded — every claim status comes from the bundle, never from the model.
 */

import { describe, expect, it } from "vitest";

import type { EvaluationRun, StructuredEvaluation } from "@/services/evaluation-agent/schema";
import type { EvidenceBundle, EvidenceObservation } from "@/services/evidence/types";
import { CLAIM_STATUS_DISCLAIMER } from "@/services/evidence/types";
import { buildInspectionReport, detectProjectType } from "@/services/inspection";
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
  team: "Team Aqua",
  problemStatement: null,
  solution: "A React dashboard with a TensorFlow soil-moisture model.",
  technologies: ["React", "TensorFlow"],
  repoUrl: "https://github.com/acme/aquasense",
  demoUrl: "https://aquasense.example.com",
  media: [],
  teamMembers: [],
  submitted: [],
  presentationClaims: {
    summary: "AquaSense — Smart Irrigation",
    problem: ["Farmers cannot see soil moisture in real time"],
    features: ["Google authentication for farm managers"],
  },
};

function observation(overrides: Partial<EvidenceObservation>): EvidenceObservation {
  return {
    id: "site.accessibility.https",
    area: "accessibility",
    label: "HTTPS",
    status: "good",
    result: "The deployed URL is served over HTTPS.",
    evidence: ["https://aquasense.example.com"],
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
        detail: "The team's own submission text and deck.",
        highlights: ["Declared technologies: React, TensorFlow."],
        observations: [],
      },
      {
        kind: "document",
        label: "Submitted deck",
        status: "ingested",
        readable: true,
        url: null,
        detail: "Presentation text extracted (7 pages, native text).",
        highlights: ["7 pages with text"],
        observations: [],
      },
      {
        kind: "repository",
        label: "GitHub repository",
        status: "ingested",
        readable: true,
        url: "https://github.com/acme/aquasense",
        detail: "Repository acme/aquasense was inspected.",
        highlights: ["Frameworks detected: React."],
        observations: [
          observation({
            id: "repo.code.auth",
            area: "repository",
            label: "Authentication implementation",
            status: "good",
            result: "Authentication code was found (src/auth/session.ts).",
            evidence: ["src/auth/session.ts"],
          }),
          observation({
            id: "repo.code.tests",
            area: "repository",
            label: "Automated tests",
            status: "warning",
            result: "No test files were found in the inspected repository.",
            evidence: ["package.json (no test script)"],
          }),
        ],
      },
      {
        kind: "website",
        label: "Deployed website",
        status: "ingested",
        readable: true,
        url: "https://aquasense.example.com",
        detail: "The deployed page returned HTTP 200 in 640 ms.",
        highlights: ["HTTP 200"],
        observations: [
          observation({}),
          observation({
            id: "site.security.headers",
            area: "security",
            label: "Security headers",
            status: "warning",
            result: "2 of 6 common security headers are missing.",
            evidence: ["missing: content-security-policy, x-frame-options"],
          }),
          observation({
            id: "site.security.server",
            area: "security",
            label: "Server-side vulnerabilities",
            status: "could_not_verify",
            result: "Server-side behaviour cannot be tested without intrusive probing.",
            evidence: [],
          }),
          observation({
            id: "site.performance.response",
            area: "performance",
            label: "Initial response time",
            status: "good",
            result: "The page responded in 640 ms.",
            evidence: ["640 ms"],
          }),
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
        pageRefs: [7],
      },
      {
        id: "deck.feature.1",
        claim: "Real-time sensor sync every second",
        category: "features",
        status: "partially_supported",
        sources: ["repository"],
        quotes: ["setInterval(sync, 5000)"],
        note: "Polling exists, but at five-second intervals rather than one second.",
        kind: "performance",
      },
      {
        id: "deck.impact.0",
        claim: "Used by 12 farms in Kenya",
        category: "impact",
        status: "not_found",
        sources: ["repository", "website"],
        quotes: [],
        note: "Neither the repository nor the deployed page mentions any farms or usage numbers.",
        kind: "general",
      },
      {
        id: "deck.ai.0",
        claim: "A custom vision model detects leaf disease",
        category: "technology",
        status: "could_not_verify",
        sources: [],
        quotes: [],
        note: "Could not verify: the model weights live outside the inspected repository.",
        kind: "ai",
      },
    ],
    gaps: ["Model weights are not in the repository."],
    counts: { supported: 1, partially_supported: 1, not_found: 1, could_not_verify: 1 },
    disclaimer: CLAIM_STATUS_DISCLAIMER,
    ...overrides,
  };
}

function evaluation(overrides: Partial<StructuredEvaluation> = {}): StructuredEvaluation {
  return {
    schemaVersion: "1.0",
    model: "test-model",
    evaluatedAt: "2026-02-01T00:00:00.000Z",
    summary: "A real React dashboard with a partially evidenced irrigation model.",
    overallScore: 71,
    scores: [
      { dimension: "repository", score: 78, reasoning: "Readable React app with auth code." },
    ],
    reasoning: "Repository and site were read.",
    evidence: [],
    strengths: [],
    weaknesses: [],
    redFlags: [],
    claimChecks: [],
    finalSummary: {
      projectUnderstanding: "AquaSense is a smart-irrigation dashboard for small farms.",
      strongestEvidence: ["Authentication code exists in src/auth/session.ts."],
      majorGaps: ["Model weights are not inspectable."],
      technicalAssessment: "Small React app with working auth and no tests.",
      verdict: "The stack is real; usage and model claims remain unproven.",
    },
    ...overrides,
  } as StructuredEvaluation;
}

describe("detectProjectType", () => {
  it("uses structural signals before wording", () => {
    const detected = detectProjectType({
      observations: [observation({ id: "repo.type.extension", area: "repository" })],
      technologies: ["React"],
      text: "A web app for annotating pages",
      hasReadableWebsite: false,
    });
    expect(detected.type).toBe("browser_extension");
    expect(detected.confidence).toBe("high");
  });

  it("recognises a web app from a readable deployment", () => {
    const detected = detectProjectType({
      observations: [],
      technologies: [],
      text: "AquaSense",
      hasReadableWebsite: true,
    });
    expect(detected.type).toBe("web_app");
  });

  it("does not assume every project is a web app", () => {
    const detected = detectProjectType({
      observations: [],
      technologies: ["Flutter"],
      text: "A Flutter app for farm workers",
      hasReadableWebsite: false,
    });
    expect(detected.type).toBe("mobile_app");
    expect(detected.confidence).toBe("medium");
  });

  it("falls back to other when nothing is decisive", () => {
    const detected = detectProjectType({
      observations: [],
      technologies: [],
      text: "An experiment",
      hasReadableWebsite: false,
    });
    expect(detected.type).toBe("other");
    expect(detected.reasons[0]).toMatch(/no decisive platform signal/i);
  });
});

describe("buildInspectionReport", () => {
  it("summarises claim counts in plain language", () => {
    const report = buildInspectionReport({
      detail: project,
      bundle: bundle(),
      evaluation: evaluation(),
    });

    expect(report.verdict.counts).toEqual({
      supported: 1,
      partially_supported: 1,
      not_found: 1,
      could_not_verify: 1,
      total: 4,
    });
    expect(report.verdict.headline).toMatch(/3 claims could not be fully verified/i);
    expect(report.verdict.judgeBullets.length).toBeGreaterThanOrEqual(3);
    expect(report.verdict.judgeBullets.length).toBeLessThanOrEqual(5);
  });

  it("treats 'not found' and 'could not verify' differently", () => {
    const report = buildInspectionReport({
      detail: project,
      bundle: bundle(),
      evaluation: evaluation(),
    });

    const claims = report.sections.find((section) => section.id === "claims")!;
    const notFound = claims.checks.find((check) => check.status === "not_found")!;
    const unchecked = claims.checks.find((check) => check.status === "could_not_verify")!;
    expect(notFound.result).toBe("Not found");
    expect(unchecked.result).toBe("Could not verify");
    expect(unchecked.explanation).toMatch(/not/i);
    expect(report.sections.map((section) => section.letter)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
      "I",
      "J",
    ]);
  });

  it("cites the deck page and file path behind a claim", () => {
    const report = buildInspectionReport({
      detail: { ...project, presentationPages: [{ page: 7, text: "Google authentication" }] },
      bundle: bundle(),
      evaluation: evaluation(),
    });

    const claims = report.sections.find((section) => section.id === "claims")!;
    const auth = claims.checks.find((check) => check.id === "claim:deck.feature.0")!;
    expect(auth.evidence.some((item) => /page\/slide 7/i.test(item))).toBe(true);
    expect(auth.evidence.some((item) => /repository/i.test(item))).toBe(true);

    const deck = report.sections.find((section) => section.id === "document")!;
    expect(deck.checks.find((check) => check.id === "document.page_refs")?.status).toBe("good");
  });

  it("never invents an AI summary or score when the model did not run", () => {
    const report = buildInspectionReport({
      detail: project,
      bundle: bundle(),
      evaluation: null,
      runError: "The evaluation model is not configured.",
    });

    expect(report.verdict.score).toBeNull();
    expect(report.verdict.aiAvailable).toBe(false);
    expect(report.verdict.aiSummary).toBeNull();
    expect(report.ai.available).toBe(false);
    const ai = report.sections.find((section) => section.id === "ai")!;
    expect(ai.status).toBe("could_not_verify");
    expect(ai.checks[0]?.result).toMatch(/unavailable/i);
    expect(ai.checks[0]?.explanation).toMatch(/not configured/i);
    expect(report.verdict.headline).not.toMatch(/secure/i);
  });

  it("says it could not verify rather than failing when nothing is readable", () => {
    const empty = bundle({
      sources: [
        {
          kind: "repository",
          label: "GitHub repository",
          status: "failed",
          readable: false,
          url: "https://github.com/acme/private",
          detail: "The repository is private, so it could not be read.",
          highlights: [],
          observations: [],
        },
      ],
      claims: [],
      gaps: ["Repository could not be read."],
      counts: { supported: 0, partially_supported: 0, not_found: 0, could_not_verify: 0 },
    });

    const report = buildInspectionReport({ detail: project, bundle: empty, evaluation: null });
    expect(report.verdict.tone).toBe("unverified");
    expect(report.verdict.headline).toMatch(/not enough could be inspected/i);

    const repo = report.sections.find((section) => section.id === "repository")!;
    expect(repo.checks[0]?.status).toBe("could_not_verify");
    expect(repo.checks[0]?.explanation).toMatch(/private/i);
    expect(report.sections.every((section) => section.checks.length > 0)).toBe(true);
  });

  it("does not blame a mobile app for having no deployed website", () => {
    const mobile: ProjectDetail = {
      ...project,
      description: "A Flutter app for farm workers",
      demoUrl: null,
      technologies: ["Flutter"],
    };
    const report = buildInspectionReport({
      detail: mobile,
      bundle: bundle({ sources: bundle().sources.filter((source) => source.kind !== "website") }),
      evaluation: null,
    });

    expect(report.projectType).toBe("mobile_app");
    const deployment = report.sections.find((section) => section.id === "deployment")!;
    expect(deployment.checks[0]?.explanation).toMatch(/does not need a deployed website/i);
    expect(report.verdict.missingInputs.join(" ")).not.toMatch(/deployed URL/i);
  });

  it("keeps security honest about what was not tested", () => {
    const report = buildInspectionReport({
      detail: project,
      bundle: bundle(),
      evaluation: evaluation(),
    });
    const security = report.sections.find((section) => section.id === "security")!;
    const server = security.checks.find((check) => check.id === "site.security.server")!;
    expect(server.status).toBe("could_not_verify");
    expect(security.checks.map((check) => check.status)).toContain("warning");
    expect(report.verdict.security.join(" ")).not.toMatch(/^Secure$/m);
  });
});

describe("EvaluationRun type still carries the bundle", () => {
  it("accepts a run with and without the persisted bundle", () => {
    const withBundle = {
      id: "run-1",
      status: "completed",
      submission: { name: project.name },
      result: evaluation(),
      evidenceBundle: bundle(),
    } as EvaluationRun;
    expect(withBundle.evidenceBundle?.claims.length).toBe(4);
  });
});
