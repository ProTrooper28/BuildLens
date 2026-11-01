/**
 * Inspection report builder.
 *
 * Pure function: the evidence bundle in, one report out. Nothing here calls a
 * model or the network, so the judge summary is available even when the AI stage
 * is unavailable — and the same input always produces the same report.
 *
 * Ground rules encoded below:
 *   • only observations collected by the source readers become findings;
 *   • “could not verify” never becomes a negative statement;
 *   • the README/deck never verifies itself — claims are checked by the bundle’s
 *     deterministic comparison;
 *   • no score is invented: automated scores appear only when the model ran.
 */

import type { StructuredEvaluation } from "@/services/evaluation-agent/schema";
import { candidateFactsFrom } from "@/services/evidence/classify";
import {
  CLAIM_SOURCE_FINDING_LABELS,
  CLAIM_STATUS_LABELS,
  CLAIM_TYPE_LABELS,
  CLAIM_VERDICT_LABELS,
  claimVerdictCounts,
  verdictOf,
  type ClaimCheck,
  type ClaimSourceFinding,
  type EvidenceBundle,
  type EvidenceObservation,
  type EvidenceSourceReport,
  type ObservationArea,
} from "@/services/evidence/types";
import { claimTypeOf } from "@/services/evidence/classify";
import { attentionFindings, buildFindings, severityCounts } from "./findings";
import type {
  ClaimVerificationRow,
  DeploymentRowId,
  DeploymentInspection,
  DeploymentRow,
  EvidenceDimension,
  Finding,
} from "./types";
import type { ProjectDetail } from "@/types/evaluation";
import { detectProjectType, requiredInputs } from "./project-type";
import {
  CHECK_STATUS_LABELS,
  INSPECTION_DISCLAIMER,
  INSPECTION_SECTIONS,
  PROJECT_TYPE_LABELS,
  PROJECT_TYPE_STRATEGY,
  VERDICT_TONE_LABELS,
  type CheckStatus,
  type ClaimCounts,
  type InspectionCheck,
  type InspectionReport,
  type InspectionSection,
  type InspectionSectionId,
  type JudgeVerdict,
  type ProjectType,
  type VerdictTone,
} from "./types";

export interface InspectionInput {
  detail: ProjectDetail;
  bundle: EvidenceBundle | null;
  evaluation: StructuredEvaluation | null;
  /** Model-stage failure, shown next to the AI section instead of a blank. */
  runError?: string | null;
}

const SECTION_BY_AREA: Record<ObservationArea, InspectionSectionId> = {
  accessibility: "deployment",
  functionality: "functionality",
  ux: "functionality",
  performance: "performance",
  security: "security",
  repository: "repository",
  document: "document",
  evaluation: "rubric",
};

const SOURCE_SHORT: Record<string, string> = {
  repository: "repository",
  website: "deployed site",
  document: "submitted deck",
  submission: "submission form",
};

const DIMENSION_LABELS: Record<string, string> = {
  project_description: "Project description",
  presentation: "Presentation (deck)",
  repository: "Repository",
  website: "Deployed website",
  technical_implementation: "Technical implementation",
  features_functionality: "Features & functionality",
  evidence_integrity: "Evidence integrity",
};

/* ------------------------------------------------------------------ helpers */

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** First sentence, clipped — the short “result” line of a check. */
function headlineOf(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const first = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  return clip(first.length >= 12 ? first : clean, max);
}

function zeroCounts(): ClaimCounts {
  return { supported: 0, partially_supported: 0, not_found: 0, could_not_verify: 0 };
}

function isNegative(status: CheckStatus): boolean {
  return status === "warning" || status === "critical" || status === "not_found";
}

function aggregateStatus(checks: readonly InspectionCheck[]): CheckStatus {
  if (checks.length === 0) return "could_not_verify";
  if (checks.some((check) => check.status === "critical")) return "critical";
  if (checks.some((check) => isNegative(check.status) || check.status === "partially_supported")) {
    return "warning";
  }
  if (checks.every((check) => check.status === "could_not_verify")) return "could_not_verify";
  if (checks.some((check) => check.status === "good" || check.status === "supported")) return "good";
  return "info";
}

function observationCheck(observation: EvidenceObservation): InspectionCheck {
  return {
    id: observation.id,
    section: SECTION_BY_AREA[observation.area],
    title: observation.label,
    result: headlineOf(observation.result),
    status: observation.status,
    explanation: observation.result,
    evidence: observation.evidence,
    confidence: observation.confidence,
  };
}

function sectionOf(
  id: InspectionSectionId,
  checks: InspectionCheck[],
  summary: string,
  empty: string | null = null,
): InspectionSection {
  const meta = INSPECTION_SECTIONS.find((entry) => entry.id === id);
  if (!meta) throw new Error(`Unknown inspection section ${id}`);
  return {
    id,
    letter: meta.letter,
    label: meta.label,
    description: meta.description,
    summary,
    status: aggregateStatus(checks),
    checks,
    empty: checks.length > 0 ? null : empty,
  };
}

function claimChecks(bundle: EvidenceBundle | null): InspectionCheck[] {
  if (!bundle) return [];
  return bundle.claims.map((claim) => {
    const refs = claim.pageRefs ?? [];
    const sources = claim.sources.map((kind) => SOURCE_SHORT[kind] ?? kind);
    return {
      id: `claim:${claim.id}`,
      section: "claims" as const,
      title: claim.claim,
      result: CLAIM_STATUS_LABELS[claim.status],
      status: claim.status,
      explanation: claim.note,
      evidence: [
        ...(refs.length > 0 ? [`Found on deck page/slide ${refs.join(", ")}`] : []),
        ...(sources.length > 0
          ? [`Checked against: ${sources.join(", ")}`]
          : ["No verification source could be read"]),
        // Where to look: the file/URL that backs the status, or the sources
        // that were searched when nothing was found.
        ...(claim.evidenceRefs ?? []).map((ref) =>
          claim.status === "not_found" ? `Searched: ${ref}` : `Evidence: ${ref}`,
        ),
        ...claim.quotes.map((quote) => `“${clip(quote, 220)}”`),
      ],
      confidence:
        claim.status === "could_not_verify" ? "low" : claim.quotes.length > 0 ? "high" : "medium",
      ...(claim.kind ? { claimKind: claim.kind } : {}),
      ...(refs.length > 0 ? { pageRefs: refs } : {}),
    };
  });
}

/* ----------------------------------------------------------------- sections */

function documentSection(detail: ProjectDetail, bundle: EvidenceBundle | null): InspectionSection {
  const source = bundle?.sources.find((entry) => entry.kind === "document") ?? null;
  const pages = detail.presentationPages ?? [];
  const deckClaims = (bundle?.claims ?? []).filter((claim) => claim.id.startsWith("deck."));
  const withPages = deckClaims.filter((claim) => (claim.pageRefs ?? []).length > 0);
  const checks: InspectionCheck[] = [];

  if (!source || !source.readable) {
    checks.push({
      id: "document.readable",
      section: "document",
      title: "Presentation document",
      result: source ? headlineOf(source.detail) : "No presentation submitted",
      status: "could_not_verify",
      explanation:
        source?.detail ??
        "No PPT/PDF was attached to this submission, so nothing was extracted and no deck claims were checked.",
      evidence: source?.url ? [source.url] : [],
      confidence: "high",
    });
    return sectionOf(
      "document",
      checks,
      "No readable presentation — deck claims could not be checked.",
      "Attach a PPT/PDF to make presentation claims verifiable.",
    );
  }

  checks.push({
    id: "document.readable",
    section: "document",
    title: "Presentation readable",
    result: headlineOf(source.detail),
    status: "good",
    explanation: `${source.detail} The submitted deck is treated as the team's claims, never as proof.`,
    evidence: source.highlights.slice(0, 6),
    confidence: "high",
  });

  checks.push({
    id: "document.pages",
    section: "document",
    title: "Pages / slides with readable text",
    result:
      pages.length > 0
        ? `${pages.length} page${pages.length === 1 ? "" : "s"} carried text`
        : "Page breakdown unavailable",
    status: pages.length > 0 ? "good" : "could_not_verify",
    explanation:
      pages.length > 0
        ? `Text was extracted from ${pages.length} page${pages.length === 1 ? "" : "s"}, which is what the claims below are based on.`
        : "The document was read, but per-page text was not stored with this submission, so page numbers cannot be shown.",
    evidence: pages.slice(0, 8).map((page) => `Page ${page.page}: ${clip(page.text, 90)}`),
    confidence: pages.length > 0 ? "high" : "low",
  });

  checks.push({
    id: "document.claims",
    section: "document",
    title: "Claims extracted from the deck",
    result: `${deckClaims.length} claim${deckClaims.length === 1 ? "" : "s"}`,
    status: deckClaims.length > 0 ? "info" : "warning",
    explanation:
      deckClaims.length > 0
        ? `BuildLens treated ${deckClaims.length} statement${deckClaims.length === 1 ? "" : "s"} from the deck as checkable claims and compared each one with the repository and deployment.`
        : "The deck was readable but no checkable claims were extracted from it. Filler and headings are not treated as claims.",
    evidence: deckClaims.slice(0, 8).map((claim) => {
      const refs = claim.pageRefs ?? [];
      return `${refs.length > 0 ? `p.${refs.join(", ")} — ` : ""}${clip(claim.claim, 120)}`;
    }),
    confidence: "medium",
  });

  checks.push({
    id: "document.page_refs",
    section: "document",
    title: "Page references",
    result:
      withPages.length > 0
        ? `${withPages.length} claim${withPages.length === 1 ? "" : "s"} located on a page`
        : "No page numbers recorded",
    status: withPages.length > 0 ? "good" : "could_not_verify",
    explanation:
      withPages.length > 0
        ? "Claims were located in the extracted page text, so the judge can open the referenced slide."
        : "This document's pages were not stored individually, so claims cannot be pinned to a slide number.",
    evidence: withPages.map((claim) => `p.${(claim.pageRefs ?? []).join(", ")} — ${clip(claim.claim, 90)}`),
    confidence: withPages.length > 0 ? "high" : "low",
  });

  if (source.highlights.some((highlight) => /ocr/i.test(highlight))) {
    checks.push({
      id: "document.ocr",
      section: "document",
      title: "Scanned pages / OCR",
      result: "OCR was used for at least part of the document",
      status: "info",
      explanation: "Text on image-only pages was read with OCR, so it may contain recognition errors.",
      evidence: source.highlights.filter((highlight) => /ocr/i.test(highlight)).slice(0, 3),
      confidence: "medium",
    });
  }

  return sectionOf(
    "document",
    checks,
    deckClaims.length > 0
      ? `${deckClaims.length} claim${deckClaims.length === 1 ? "" : "s"} from the deck${withPages.length > 0 ? `, ${withPages.length} with page references` : ""}.`
      : "Deck read, but no checkable claims were extracted.",
  );
}

function repositorySection(bundle: EvidenceBundle | null): InspectionSection {
  const source = bundle?.sources.find((entry) => entry.kind === "repository") ?? null;
  const observations = (source?.observations ?? []).filter((entry) => entry.area === "repository");
  const checks = observations.map(observationCheck);

  if (!source || !source.readable) {
    checks.unshift({
      id: "repository.readable",
      section: "repository",
      title: "Repository inspection",
      result: source ? headlineOf(source.detail) : "No repository submitted",
      status: "could_not_verify",
      explanation:
        source?.detail ??
        "No repository URL was submitted, so implementation could not be checked against the claims.",
      evidence: source?.url ? [source.url] : [],
      confidence: "high",
    });
  }

  const tests = observations.find((entry) => entry.id === "repo.code.tests");
  const auth = observations.find((entry) => entry.id === "repo.code.auth");
  const summaryParts = [
    tests ? (tests.status === "good" ? "tests present" : "no tests found") : null,
    auth ? (auth.status === "good" ? "auth code found" : "no auth code detected") : null,
  ].filter((value): value is string => Boolean(value));

  return sectionOf(
    "repository",
    checks,
    summaryParts.length > 0
      ? `Repository read: ${summaryParts.join(" · ")}.`
      : "No repository was read for this submission.",
    "Submit a public repository URL to inspect implementation evidence.",
  );
}

function deploymentSection(
  detail: ProjectDetail,
  bundle: EvidenceBundle | null,
  type: ProjectType,
): InspectionSection {
  const source = bundle?.sources.find((entry) => entry.kind === "website") ?? null;
  const observations = (source?.observations ?? []).filter(
    (entry) => entry.area === "accessibility",
  );
  const checks = observations.map(observationCheck);
  const needsSite = requiredInputs(type).website;

  if (!detail.demoUrl) {
    checks.unshift({
      id: "deployment.provided",
      section: "deployment",
      title: "Deployed application",
      result: "No deployed URL submitted",
      status: "could_not_verify",
      explanation: needsSite
        ? "No deployed URL was submitted, so the live application could not be inspected. That is a gap in the evidence, not proof that the app does not work."
        : `A ${PROJECT_TYPE_LABELS[type].toLowerCase()} does not need a deployed website, so this is not counted against the project.`,
      evidence: [],
      confidence: "high",
    });
  } else if (!source || !source.readable) {
    checks.unshift({
      id: "deployment.readable",
      section: "deployment",
      title: "Deployed application",
      result: source ? headlineOf(source.detail) : "Deployment not inspected",
      status: "could_not_verify",
      explanation:
        source?.detail ??
        "The deployed URL was submitted but the page could not be read, so nothing about the live app was verified.",
      evidence: source?.url ? [source.url] : [],
      confidence: "high",
    });
  }

  const https = observations.find((entry) => entry.id === "site.accessibility.https");
  const status = observations.find((entry) => entry.id === "site.accessibility.status");
  const summary =
    https && status
      ? `${https.status === "good" ? "HTTPS" : "Plain HTTP"} · ${headlineOf(status.result, 70)}`
      : detail.demoUrl
        ? "Deployed URL submitted but the page could not be read."
        : "No deployed URL submitted.";

  return sectionOf(
    "deployment",
    checks,
    summary,
    "Submit a deployed URL to inspect the live application.",
  );
}

function areaSection(
  id: InspectionSectionId,
  bundle: EvidenceBundle | null,
  areas: ObservationArea[],
  summaryFallback: string,
  empty: string,
): InspectionSection {
  const observations = (bundle?.sources ?? []).flatMap((source) =>
    (source.observations ?? []).filter((entry) => areas.includes(entry.area)),
  );
  const checks = observations.map(observationCheck);

  if (checks.length === 0) {
    checks.push({
      id: `${id}.unavailable`,
      section: id,
      title: INSPECTION_SECTIONS.find((entry) => entry.id === id)?.label ?? id,
      result: "Not checked",
      status: "could_not_verify",
      explanation: summaryFallback,
      evidence: [],
      confidence: "high",
    });
  }

  const critical = checks.filter((check) => check.status === "critical").length;
  const warnings = checks.filter((check) => check.status === "warning").length;
  const good = checks.filter((check) => check.status === "good").length;

  return sectionOf(
    id,
    checks,
    critical > 0
      ? `${critical} critical finding${critical === 1 ? "" : "s"}${warnings > 0 ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}.`
      : warnings > 0
        ? `${warnings} warning${warnings === 1 ? "" : "s"}${good > 0 ? `, ${good} check${good === 1 ? "" : "s"} passed` : ""}.`
        : good > 0
          ? `${good} check${good === 1 ? "" : "s"} ran without a warning.`
          : "Nothing could be checked for this area.",
    empty,
  );
}

function aiSection(
  evaluation: StructuredEvaluation | null,
  runError: string | null | undefined,
): InspectionSection {
  const checks: InspectionCheck[] = [];

  if (!evaluation) {
    checks.push({
      id: "ai.unavailable",
      section: "ai",
      title: "AI analysis",
      result: "AI summary unavailable",
      status: "could_not_verify",
      explanation:
        `${runError ? `${headlineOf(runError, 180)} ` : ""}The deterministic inspection above is complete — no AI narrative was invented to fill the gap.`.trim(),
      evidence: [],
      confidence: "high",
    });
    return sectionOf(
      "ai",
      checks,
      "AI analysis is unavailable; the evidence findings are still complete.",
      "Configure the evaluation model to add an AI narrative.",
    );
  }

  const summary = evaluation.finalSummary;
  checks.push(
    {
      id: "ai.verdict",
      section: "ai",
      title: "AI verdict",
      result: headlineOf(summary.verdict),
      status: "info",
      explanation: summary.verdict,
      evidence: [],
      confidence: "medium",
    },
    {
      id: "ai.understanding",
      section: "ai",
      title: "What the project is",
      result: headlineOf(summary.projectUnderstanding),
      status: "info",
      explanation: summary.projectUnderstanding,
      evidence: [],
      confidence: "medium",
    },
    {
      id: "ai.technical",
      section: "ai",
      title: "Technical assessment",
      result: headlineOf(summary.technicalAssessment),
      status: "info",
      explanation: summary.technicalAssessment,
      evidence: [],
      confidence: "medium",
    },
    {
      id: "ai.strengths",
      section: "ai",
      title: "Strongest evidence",
      result:
        summary.strongestEvidence.length > 0
          ? `${summary.strongestEvidence.length} strength${summary.strongestEvidence.length === 1 ? "" : "s"}`
          : "None recorded",
      status: summary.strongestEvidence.length > 0 ? "good" : "could_not_verify",
      explanation:
        "These are the concrete, evidence-backed points the model found — it was required to quote the sources.",
      evidence: summary.strongestEvidence,
      confidence: "medium",
    },
    {
      id: "ai.gaps",
      section: "ai",
      title: "Gaps and inconsistencies",
      result:
        summary.majorGaps.length > 0
          ? `${summary.majorGaps.length} gap${summary.majorGaps.length === 1 ? "" : "s"}`
          : "None recorded",
      status: summary.majorGaps.length > 0 ? "warning" : "good",
      explanation:
        "Missing or contradictory evidence, including sources that could not be read. Not a judgement on the team.",
      evidence: summary.majorGaps,
      confidence: "medium",
    },
  );

  for (const [index, flag] of evaluation.redFlags.entries()) {
    checks.push({
      id: `ai.redflag.${index}`,
      section: "ai",
      title: flag.label,
      result: `${flag.severity === "high" ? "High" : flag.severity === "medium" ? "Medium" : "Low"} severity`,
      status: flag.severity === "high" ? "critical" : flag.severity === "medium" ? "warning" : "info",
      explanation: flag.detail,
      evidence: [],
      confidence: "medium",
    });
  }

  return sectionOf(
    "ai",
    checks,
    evaluation.model ? `AI analysis by ${evaluation.model}.` : "AI analysis completed.",
  );
}

function rubricSection(evaluation: StructuredEvaluation | null): InspectionSection {
  const checks: InspectionCheck[] = [];

  if (evaluation) {
    for (const score of evaluation.scores) {
      checks.push({
        id: `rubric.${score.dimension}`,
        section: "rubric",
        title: DIMENSION_LABELS[score.dimension] ?? score.dimension,
        result: `${score.score}/100`,
        status: score.score >= 70 ? "good" : score.score >= 45 ? "warning" : "critical",
        explanation: score.reasoning,
        evidence: [],
        confidence: "medium",
      });
    }
    checks.push({
      id: "rubric.judge",
      section: "rubric",
      title: "Your rubric marks",
      result: "Scored separately by you",
      status: "info",
      explanation:
        "These are automated signals only. The criterion scores and recommendation you save on the evaluation page remain the official result.",
      evidence: [],
      confidence: "high",
    });
  } else {
    checks.push({
      id: "rubric.unavailable",
      section: "rubric",
      title: "Automated rubric signals",
      result: "Unavailable",
      status: "could_not_verify",
      explanation:
        "No automated dimension scores were produced for this submission. Your rubric on the evaluation page is unaffected.",
      evidence: [],
      confidence: "high",
    });
  }

  const scored = checks.filter((check) => check.id.startsWith("rubric.") && check.result.includes("/100"));
  const average =
    scored.length > 0
      ? Math.round(
          scored.reduce((sum, check) => sum + Number(check.result.replace("/100", "")), 0) /
            scored.length,
        )
      : null;

  return sectionOf(
    "rubric",
    checks,
    average !== null
      ? `Automated dimension average ${average}/100 across ${scored.length} dimensions. Final marks stay with you.`
      : "No automated rubric signals for this submission.",
  );
}

function evidenceSection(
  bundle: EvidenceBundle | null,
  counts: ClaimCounts & { total: number },
): InspectionSection {
  const sources = bundle?.sources ?? [];
  const checks: InspectionCheck[] = sources.map((source: EvidenceSourceReport) => ({
    id: `evidence.${source.kind}`,
    section: "evidence",
    title: source.label,
    result: source.readable ? "Read" : "Could not be read",
    status: source.readable ? "good" : "could_not_verify",
    explanation: source.detail,
    evidence: [...source.highlights.slice(0, 6), ...(source.url ? [source.url] : [])],
    confidence: source.readable ? "high" : "medium",
  }));

  if (bundle && bundle.claims.length > 0) {
    checks.push({
      id: "evidence.claims",
      section: "evidence",
      title: "Claims checked",
      result: `${counts.total} claim${counts.total === 1 ? "" : "s"}`,
      status: "info",
      explanation: `${counts.supported} supported · ${counts.partially_supported} partially supported · ${counts.not_found} not found · ${counts.could_not_verify} could not be verified.`,
      evidence: bundle.gaps,
      confidence: "high",
    });
  }

  return sectionOf(
    "evidence",
    checks,
    `${sources.filter((source) => source.readable).length} of ${sources.length} source${sources.length === 1 ? "" : "s"} read.`,
  );
}

/* ------------------------------------------------------------------ verdict */

function verdictTone(
  counts: ClaimCounts & { total: number },
  checks: readonly InspectionCheck[],
  readableVerification: number,
): VerdictTone {
  if (readableVerification === 0) return "unverified";
  if (counts.total === 0) return "limited";
  const critical = checks.filter((check) => check.status === "critical").length;
  const ratio = counts.supported / counts.total;
  if (ratio >= 0.6 && critical === 0) return "strong";
  if (ratio >= 0.35) return "promising";
  if (counts.supported > 0) return "mixed";
  return "limited";
}

const TONE_LEAD: Record<VerdictTone, string> = {
  strong: "Strong project",
  promising: "Promising project",
  mixed: "Mixed picture",
  limited: "Limited evidence",
  unverified: "Not enough inspectable evidence",
};

/**
 * Plain-language bullets for "What the judge should know".
 *
 * They summarise the risk picture rather than the evidence inventory: claim
 * verification first, then the single most serious finding, then the state of
 * the deployment and the repository. Grouped, never one line per claim.
 */
function judgeBullets(input: {
  type: ProjectType;
  counts: ClaimCounts & { total: number };
  verdictCounts: ReturnType<typeof claimVerdictCounts> & { total: number };
  checks: readonly InspectionCheck[];
  bundle: EvidenceBundle | null;
  detail: ProjectDetail;
  tone: VerdictTone;
  missingInputs: string[];
  findings: readonly Finding[];
}): string[] {
  const { counts, verdictCounts, bundle, detail, tone, missingInputs, findings } = input;
  const bullets: string[] = [];

  if (counts.total > 0) {
    const open =
      verdictCounts.unverified + verdictCounts.unsupported + verdictCounts.contradicted;
    const parts = [
      `${verdictCounts.verified} of ${counts.total} claims verified`,
      verdictCounts.partially_verified > 0 ? `${verdictCounts.partially_verified} partial` : null,
      open > 0 ? `${open} unverified` : null,
      verdictCounts.unsupported > 0 ? `${verdictCounts.unsupported} unsupported` : null,
      verdictCounts.contradicted > 0 ? `${verdictCounts.contradicted} contradicted` : null,
    ].filter(Boolean);
    bullets.push(`${open === 0 ? "✓" : "⚠"} Claim verification: ${parts.join(" · ")}.`);
  } else {
    bullets.push("• No checkable claims were submitted, so claim verification could not run.");
  }

  const top = findings[0] ?? null;
  if (top) {
    const mark =
      top.severity === "critical" ? "✕" : top.severity === "high" ? "⚠" : "•";
    bullets.push(`${mark} ${clip(top.title, 120)} — ${clip(top.summary, 110)}`);
  }

  const site = bundle?.sources.find((source) => source.kind === "website") ?? null;
  if (detail.demoUrl) {
    bullets.push(
      site?.readable
        ? "✓ The deployed application was reached and its public page inspected."
        : "⚠ The submitted deployment could not be read, so live behaviour is unverified.",
    );
  } else if (requiredInputs(input.type).website) {
    bullets.push("⚠ No deployed URL was submitted, so the live application is unverified.");
  }

  const repo = bundle?.sources.find((source) => source.kind === "repository") ?? null;
  if (repo?.readable) {
    bullets.push("✓ The repository was read, and its code and configuration are the implementation evidence.");
  } else if (detail.repoUrl) {
    bullets.push("⚠ The repository could not be read, so implementation evidence is unverified.");
  }

  if (missingInputs.length > 0 && bullets.length < 5) {
    bullets.push(`⚠ ${missingInputs[0]}`);
  } else if (tone === "unverified" && bullets.length < 5) {
    bullets.push("⚠ Too little could be read to verify the project — ask the team for a demo.");
  }

  return bullets.slice(0, 5);
}

/**
 * Evidence-based dimension scores.
 *
 * A dimension is scored only when there is evidence to score it with, and every
 * score carries the reason it moved — the judge can see "why 6/10" instead of
 * trusting a number. No dimension is invented from a missing source.
 */
function buildDimensions(input: {
  bundle: EvidenceBundle | null;
  deployment: DeploymentInspection;
  verdictCounts: ReturnType<typeof claimVerdictCounts> & { total: number };
  findings: readonly Finding[];
}): EvidenceDimension[] {
  const { bundle, deployment, verdictCounts, findings } = input;
  const observations = (bundle?.sources ?? []).flatMap((source) => source.observations ?? []);
  const dimensions: EvidenceDimension[] = [];

  if (verdictCounts.total > 0) {
    const weighted =
      verdictCounts.verified * 1 +
      verdictCounts.partially_verified * 0.5 +
      verdictCounts.unverified * 0.15 +
      verdictCounts.unsupported * 0 +
      verdictCounts.contradicted * 0;
    const scored = verdictCounts.total - verdictCounts.unverified * 0.5;
    dimensions.push({
      id: "claims",
      label: "Claim verification",
      score: Math.max(0, Math.min(100, Math.round((weighted / Math.max(scored, 1)) * 100))),
      reason: `${verdictCounts.verified} verified · ${verdictCounts.partially_verified} partial · ${verdictCounts.unverified} unverified · ${verdictCounts.unsupported} unsupported · ${verdictCounts.contradicted} contradicted.`,
      section: "claims",
    });
  }

  const security = observations.filter((observation) => observation.area === "security");
  const securityMeasured = security.filter(
    (observation) => observation.status === "good" || observation.status === "warning" || observation.status === "critical" || observation.status === "not_detected",
  );
  if (securityMeasured.length > 0) {
    const critical = securityMeasured.filter((entry) => entry.status === "critical").length;
    const warning = securityMeasured.filter((entry) => entry.status === "warning").length;
    dimensions.push({
      id: "security",
      label: "Security",
      score: Math.max(5, 100 - critical * 45 - warning * 15),
      reason:
        critical > 0
          ? `${critical} critical and ${warning} warning security signal${warning === 1 ? "" : "s"} in the public sources.`
          : warning > 0
            ? `${warning} warning security signal${warning === 1 ? "" : "s"}; no critical exposure found in the public sources.`
            : "No critical or warning security signal in the public sources. Server-side security was not tested.",
      section: "security",
    });
  }

  const performance = observations.filter((observation) => observation.area === "performance");
  const measuredPerformance = performance.filter(
    (observation) => observation.status !== "could_not_verify" && observation.status !== "info",
  );
  if (measuredPerformance.length > 0) {
    const warning = measuredPerformance.filter((entry) => entry.status === "warning").length;
    const critical = measuredPerformance.filter((entry) => entry.status === "critical").length;
    dimensions.push({
      id: "performance",
      label: "Performance",
      score: Math.max(10, 100 - warning * 20 - critical * 40),
      reason:
        warning + critical > 0
          ? `${warning + critical} measured value${warning + critical === 1 ? " is" : "s are"} outside the recommended range.`
          : "Measured response and asset behaviour were within the recommended range.",
      section: "performance",
    });
  }

  const functionality = observations.filter(
    (observation) => observation.area === "functionality" || observation.area === "ux",
  );
  const measuredFunctionality = functionality.filter(
    (observation) => observation.status !== "could_not_verify" && observation.status !== "info",
  );
  if (measuredFunctionality.length > 0) {
    const negative = measuredFunctionality.filter(
      (entry) => entry.status === "warning" || entry.status === "critical" || entry.status === "not_detected",
    ).length;
    dimensions.push({
      id: "functionality",
      label: "Functionality",
      score: Math.max(15, 100 - negative * 25),
      reason:
        negative > 0
          ? `${negative} of ${measuredFunctionality.length} observed functionality checks did not show the expected behaviour.`
          : `${measuredFunctionality.length} observed functionality check${measuredFunctionality.length === 1 ? "" : "s"} showed the expected behaviour.`,
      section: "functionality",
    });
  }

  const quality = observations.find((observation) => observation.id === "repo.quality");
  const qualityScore = quality?.result.match(/(\d{1,3})\/100/)?.[1];
  if (qualityScore) {
    dimensions.push({
      id: "code",
      label: "Code quality",
      score: Number(qualityScore),
      reason: clip(quality?.result ?? "", 140),
      section: "repository",
    });
  }

  const docs = observations.find((observation) => observation.id === "repo.code.docs");
  if (docs) {
    dimensions.push({
      id: "documentation",
      label: "Documentation",
      score: docs.status === "good" ? 85 : docs.status === "warning" ? 40 : null,
      reason: clip(docs.result, 140),
      section: "repository",
    });
  }

  if (deployment.applicable && deployment.rows.some((row) => row.status === "good")) {
    dimensions.push({
      id: "deployment",
      label: "Deployment",
      score: null,
      reason: deployment.rows
        .filter((row) => row.status !== "could_not_verify")
        .map((row) => `${row.label}: ${row.value}`)
        .join(" · "),
      section: "deployment",
    });
  }

  // Findings with no dimension of their own still explain the score picture.
  const highFindings = findings.filter((entry) => entry.severity === "critical" || entry.severity === "high");
  if (highFindings.length > 0 && dimensions.length === 0) {
    dimensions.push({
      id: "review",
      label: "Review needed",
      score: null,
      reason: `${highFindings.length} finding${highFindings.length === 1 ? "" : "s"} need a judge's decision before scoring.`,
      section: "claims",
    });
  }

  return dimensions;
}

function buildDeployment(
  detail: ProjectDetail,
  bundle: EvidenceBundle | null,
  type: ProjectType,
  generatedAt: string,
): JudgeVerdict["deployment"] {
  const site = bundle?.sources.find((source) => source.kind === "website") ?? null;
  const needsSite = requiredInputs(type).website;
  const httpsObs = site?.observations?.find((entry) => entry.id === "site.accessibility.https");
  const statusObs = site?.observations?.find((entry) => entry.id === "site.accessibility.status");
  const reachableObs = site?.observations?.find((entry) => entry.id === "site.accessibility.reachable");
  const perfObs = site?.observations?.find((entry) => entry.area === "performance");
  const secObs = site?.observations?.find((entry) => entry.area === "security");
  const funcObs = site?.observations?.find((entry) => entry.area === "functionality");
  const uxObs = site?.observations?.find((entry) => entry.area === "ux");

  const row = (id: DeploymentRowId, label: string, status: CheckStatus, value: string, detail: string): DeploymentRow => ({ id, label, status, value, detail });

  const accessibility = (() => {
    if (!site || !site.readable) {
      if (!detail.demoUrl) return row("availability", "Availability", "could_not_verify", "Not checked", needsSite ? "No deployed URL was submitted, so the live application was not inspected. That is a gap in the evidence, not proof that the app does not work." : `A ${PROJECT_TYPE_LABELS[type].toLowerCase()} does not need a deployed website, so this is not counted against the project.`);
      return row("availability", "Availability", "could_not_verify", "Not checked", site?.detail ?? "The submitted URL was reachable in principle but the page itself could not be read, so live availability is unverified.");
    }
    if (reachableObs?.status === "critical") return row("availability", "Availability", "critical", "Not reachable", reachableObs.result);
    if (reachableObs?.status === "warning") return row("availability", "Availability", "warning", "Partially reachable", reachableObs.result);
    return row("availability", "Availability", "good", "Online", reachableObs ? reachableObs.result : "The page was reached during inspection.");
  })();

  const https = httpsObs
    ? row("https", "HTTPS", httpsObs.status, httpsObs.status === "good" ? "Enabled" : "Plain HTTP", httpsObs.result)
    : site && site.readable
      ? row("https", "HTTPS", "could_not_verify", "Not checked", "HTTPS was not readable from the page that was served.")
      : row("https", "HTTPS", "could_not_verify", "Not checked", "No page could be read to check HTTPS.");

  const response = statusObs
    ? row("response", "Page response", statusObs.status, clip(statusObs.result, 60), statusObs.result)
    : site && site.readable
      ? row("response", "Page response", "could_not_verify", "Not measured", "No HTTP status was recorded for the served page.")
      : row("response", "Page response", "could_not_verify", "Not checked", "No page was served during inspection.");

  const performance = perfObs
    ? row("performance", "Performance", perfObs.status, clip(perfObs.result, 60), perfObs.result)
    : row("performance", "Performance", "could_not_verify", "Not measured", "No performance measurement was taken — BuildLens reports only what it can measure, never a fabricated score.");

  const functionality = funcObs
    ? row("functionality", "Functionality", funcObs.status, clip(funcObs.result, 60), funcObs.result)
    : site && site.readable
      ? row("functionality", "Functionality", "could_not_verify", "Not inspected", "The served page could be read, but no interactive functionality was directly tested.")
      : row("functionality", "Functionality", "could_not_verify", "Not checked", "No page could be read, so the live interface was not inspected.");

  const security = secObs
    ? row("security", "Security", secObs.status, clip(secObs.result, 60), secObs.result)
    : site && site.readable
      ? row("security", "Security", "could_not_verify", "Not inspected", "Only public web signals are inspected; server-side security is never tested from outside.")
      : row("security", "Security", "could_not_verify", "Not checked", "No page could be read, so public security signals were not inspected.");

  const mobile = uxObs
    ? row("mobile", "Mobile / responsive", uxObs.status, clip(uxObs.result, 60), uxObs.result)
    : row("mobile", "Mobile / responsive", "could_not_verify", "Not measured", "No responsive-layout signal was captured for the served page.");

  const limitations: string[] = [];
  if (performance.status === "could_not_verify") {
    limitations.push("No performance measurement (Lighthouse or equivalent) was taken; response behaviour is therefore not scored.");
  }
  if (functionality.status === "could_not_verify") {
    limitations.push("Interactive functionality was not directly tested; only the served page content was read.");
  }
  if (security.status === "could_not_verify") {
    limitations.push("Server-side security was not tested — this is a public-source inspection, not a penetration test.");
  }
  if (mobile.status === "could_not_verify") {
    limitations.push("Responsive/mobile layout was not measured; the served page was read at the inspection width only.");
  }

  return {
    applicable: needsSite,
    url: detail.demoUrl ?? null,
    checkedAt: generatedAt,
    rows: [accessibility, https, response, performance, functionality, security, mobile],
    observations: site
      ? (site.observations ?? []).map((entry) => entry.result)
      : [],
    evidence: [detail.demoUrl].filter(Boolean) as string[],
    limitations,
  };
}

/**
 * The claim table: candidate claim → what each independent source showed →
 * verdict. `not_checked` is never dressed up as a negative and is separated
 * from `not_found`, which is what the readable sources actually showed.
 */
function claimsTableFor(
  bundle: EvidenceBundle | null,
  needsWebsite: boolean,
): ClaimVerificationRow[] {
  if (!bundle) return [];

  return bundle.claims.map((claim) => {
    const verdict = verdictOf(claim);
    const claimType = claim.claimType ?? claimTypeOf(claim.claim, claim.category);
    const repository: ClaimSourceFinding = claim.bySource?.repository ?? "not_checked";
    const liveApp: ClaimSourceFinding = claim.bySource?.website ?? "not_checked";

    const missingEvidence: string[] = [];
    if (repository === "not_found") {
      missingEvidence.push("No matching implementation was found in the repository.");
    } else if (repository === "partial") {
      missingEvidence.push("The repository shows only part of this claim.");
    } else if (repository === "not_checked") {
      missingEvidence.push(
        "The repository was not read, so implementation evidence is missing.",
      );
    }
    if (liveApp === "not_found") {
      missingEvidence.push("The deployed application does not show this.");
    } else if (liveApp === "partial") {
      missingEvidence.push("The deployed application shows only part of this claim.");
    } else if (liveApp === "not_checked" && needsWebsite) {
      missingEvidence.push("The deployed application was not read, so live behaviour is untested.");
    }

    return {
      id: claim.id,
      claim: claim.claim,
      claimType: CLAIM_TYPE_LABELS[claimType],
      source: claim.sourceRef ?? (claim.id.startsWith("readme.") ? "README" : "Submission"),
      pageRefs: claim.pageRefs ?? [],
      repository,
      liveApp,
      verdict,
      verdictLabel: CLAIM_VERDICT_LABELS[verdict],
      note: claim.note,
      evidenceRefs: claim.evidenceRefs ?? [],
      quotes: claim.quotes,
      missingEvidence,
      contradiction: claim.contradiction ?? null,
    };
  });
}

function buildVerdict(
  detail: ProjectDetail,
  bundle: EvidenceBundle | null,
  evaluation: StructuredEvaluation | null,
  sections: InspectionSection[],
  type: ProjectType,
  generatedAt: string,
): JudgeVerdict {
  const counts: ClaimCounts & { total: number } = {
    ...(bundle?.counts ?? zeroCounts()),
    total: bundle?.claims.length ?? 0,
  };
  const checks = sections.flatMap((section) => section.checks);
  const readableVerification =
    bundle?.sources.filter(
      (source) =>
        source.readable && (source.kind === "repository" || source.kind === "website"),
    ).length ?? 0;
  const tone = verdictTone(counts, checks, readableVerification);
  const needed = requiredInputs(type);
  const missingInputs: string[] = [];
  if (needed.repository && !detail.repoUrl) {
    missingInputs.push("No repository URL — implementation could not be inspected.");
  }
  if (needed.deck && !detail.presentationClaims && !(detail.presentationPages?.length ?? 0)) {
    missingInputs.push("No readable deck — presentation claims could not be checked.");
  }
  if (needed.website && !detail.demoUrl) {
    missingInputs.push("No deployed URL — the live application could not be inspected.");
  }

  const unresolved = counts.partially_supported + counts.not_found + counts.could_not_verify;
  const headline =
    tone === "unverified"
      ? `Not enough could be inspected to verify this project — ${counts.total} claim${counts.total === 1 ? "" : "s"} remain unchecked.`
      : counts.total === 0
        ? "No checkable claims were submitted — only the sources themselves could be inspected."
        : unresolved === 0
        ? `${TONE_LEAD[tone]} — every checked claim is backed by evidence.`
        : `${TONE_LEAD[tone]}, but ${unresolved} claim${unresolved === 1 ? "" : "s"} could not be fully verified.`;

  const claims = bundle?.claims ?? [];
  const short = (value: string) => clip(value, 110);

  const deployment = buildDeployment(detail, bundle, type, generatedAt);
  const findings = buildFindings({ bundle, deployment, type });
  const attention = attentionFindings(findings);
  const verdictCounts = { ...claimVerdictCounts(claims), total: claims.length };
  const dimensions = buildDimensions({ bundle, deployment, verdictCounts, findings });
  const candidateProvided =
    bundle?.candidateProvided && bundle.candidateProvided.length > 0
      ? bundle.candidateProvided
      : candidateFactsFrom(detail.presentationPages ?? null, detail.team ?? null);
  const claimsTable = claimsTableFor(bundle, requiredInputs(type).website);

  const verified = claims
    .filter((claim) => claim.status === "supported")
    .map((claim) => short(claim.claim));
  const unverified = claims
    .filter((claim) => claim.status !== "supported")
    .map((claim) => `${short(claim.claim)} — ${CLAIM_STATUS_LABELS[claim.status].toLowerCase()}`);

  const strengths = [
    ...checks
      .filter((check) => check.status === "good" && check.section !== "claims")
      .map((check) => `${check.title}: ${clip(check.result, 90)}`),
    ...verified.map((claim) => `Supported claim: ${claim}`),
  ].slice(0, 6);

  // Problems are the grouped, severity-ranked findings — not one line per
  // claim and not one line per observation. Risk decides order.
  const problems = attention.map(
    (entry) => `${entry.severity === "critical" ? "✕" : "⚠"} ${entry.title} — ${clip(entry.summary, 110)}`,
  ).slice(0, 6);

  const security = checks
    .filter((check) => check.section === "security")
    .map((check) => `${CHECK_STATUS_LABELS[check.status]} — ${clip(check.result, 110)}`)
    .slice(0, 5);

  return {
    headline,
    tone,
    toneLabel: VERDICT_TONE_LABELS[tone],
    score: evaluation?.overallScore ?? null,
    aiAvailable: Boolean(evaluation),
    counts,
    verdictCounts,
    claimed: claims.slice(0, 5).map((claim) => short(claim.claim)),
    verified: verified.slice(0, 5),
    unverified: unverified.slice(0, 5),
    problems,
    strengths,
    security,
    claimsTable,
    findings,
    attention,
    severityCounts: severityCounts(findings),
    dimensions,
    candidateProvided,
    aiSummary:
      evaluation?.finalSummary.verdict ?? evaluation?.summary ?? null,
    judgeBullets: judgeBullets({
      type,
      counts,
      verdictCounts,
      checks,
      bundle,
      detail,
      tone,
      missingInputs,
      findings,
    }),
    projectType: type,
    projectTypeLabel: PROJECT_TYPE_LABELS[type],
    strategy: PROJECT_TYPE_STRATEGY[type],
    missingInputs,
    deployment,
  };
}

/* ------------------------------------------------------------------- report */

/** Build the judge report for one project submission. */
export function buildInspectionReport(input: InspectionInput): InspectionReport {
  const { detail, bundle, evaluation } = input;
  const sources = bundle?.sources ?? [];
  const observations = sources.flatMap((source) => source.observations ?? []);

  const detected = detectProjectType({
    observations,
    technologies: detail.technologies,
    text: [
      detail.name,
      detail.description ?? "",
      detail.problemStatement ?? "",
      detail.solution ?? "",
      ...(detail.presentationClaims?.features ?? []),
      ...(detail.presentationClaims?.solution ?? []),
      ...(detail.presentationClaims?.summary ? [detail.presentationClaims.summary] : []),
    ].join(" "),
    hasReadableWebsite: sources.some(
      (source) => source.kind === "website" && source.readable,
    ),
  });
  const type = detected.type;

  const counts = {
    ...(bundle?.counts ?? zeroCounts()),
    total: bundle?.claims.length ?? 0,
  };

  const claimRows = claimChecks(bundle);
  if (claimRows.length === 0) {
    // Never an empty section: say why there is nothing to check.
    claimRows.push({
      id: "claims.none",
      section: "claims",
      title: "Claims to verify",
      result: "No checkable claims",
      status: "could_not_verify",
      explanation:
        "No description or deck claim was available to check, so nothing was verified and nothing was marked as missing.",
      evidence: [],
      confidence: "high",
    });
  }
  const claimsSection = sectionOf(
    "claims",
    claimRows,
    claimRows.length > 0
      ? `${counts.supported} supported · ${counts.partially_supported} partial · ${counts.not_found} not found · ${counts.could_not_verify} could not verify.`
      : "No checkable claims were submitted.",
    "Add a description or attach a deck so there is something to verify.",
  );

  const sections: InspectionSection[] = [
    claimsSection,
    documentSection(detail, bundle),
    repositorySection(bundle),
    deploymentSection(detail, bundle, type),
    areaSection(
      "security",
      bundle,
      ["security"],
      "No security check could run because no site or repository was read.",
      "Submit a repository or deployed URL to inspect security signals.",
    ),
    areaSection(
      "performance",
      bundle,
      ["performance"],
      "No performance measurement could run because no deployed page was read.",
      "Submit a deployed URL to measure response and asset behaviour.",
    ),
    areaSection(
      "functionality",
      bundle,
      ["functionality", "ux"],
      "No functionality or UX signal could be collected from the sources that were read.",
      "Submit a deployed URL to inspect the public interface.",
    ),
    aiSection(evaluation, input.runError),
    rubricSection(evaluation),
    evidenceSection(bundle, counts),
  ];

  const verdict = buildVerdict(detail, bundle, evaluation, sections, type, new Date().toISOString());
  verdict.strategy = detected.reasons.length > 0
    ? `${PROJECT_TYPE_STRATEGY[type]} (${detected.reasons.join(" ")})`
    : PROJECT_TYPE_STRATEGY[type];

  return {
    generatedAt: new Date().toISOString(),
    projectType: type,
    projectTypeLabel: PROJECT_TYPE_LABELS[type],
    strategy: verdict.strategy,
    verdict,
    sections,
    sources,
    counts,
    ai: {
      available: Boolean(evaluation),
      model: evaluation?.model ?? null,
      unavailableReason: evaluation ? null : (input.runError ?? null),
    },
    disclaimer: bundle?.disclaimer ?? INSPECTION_DISCLAIMER,
  };
}
