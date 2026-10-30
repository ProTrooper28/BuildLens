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
 *   • no score is invented: the overall score is computed from the evidence by
 *     `services/verification/score`, and the model’s own score is kept apart
 *     from it.
 */

import type { StructuredEvaluation } from "@/services/evaluation-agent/schema";
import type { SecurityFinding } from "@/services/verification/types";
import {
  CLAIM_STATUS_LABELS,
  type ClaimCheck,
  type ClaimEvidenceStatus,
  type EvidenceBundle,
  type EvidenceObservation,
  type EvidenceSourceKind,
  type EvidenceSourceReport,
  type ObservationArea,
} from "@/services/evidence/types";
import {
  DEPLOYMENT_AREA_IDS,
  DEPLOYMENT_AREA_LABELS,
  type ClaimCrossCheck,
  type DeploymentArea,
  type DeploymentAreaId,
  type DeploymentBasis,
  type DeploymentCheck,
  type DeploymentHttp,
  type DeploymentInspection,
  type DeploymentRow,
  type DeploymentRowId,
} from "./types";
import type { ProjectDetail } from "@/types/evaluation";
import { buildFeatureVerification, featureCounts } from "@/services/verification/features";
import { assessDocumentMismatch, MISMATCH_LEVEL_LABELS } from "@/services/verification/mismatch";
import { assessSecurity } from "@/services/verification/security";
import { scoreBand, scoreEvaluation } from "@/services/verification/score";
import {
  SEVERITY_LABELS,
  SEVERITY_ORDER,
  VERIFICATION_RESULT_LABELS,
  type DocumentMismatch,
  type FeatureVerification,
  type ScoreBreakdown,
  type SecurityAssessment,
  type Severity,
} from "@/services/verification/types";
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
  type JudgeConcern,
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
  if (checks.some((check) => check.status === "good" || check.status === "supported"))
    return "good";
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

/** Source families shown in the per-claim cross-check (Priority 4 §6). */
const CROSS_SOURCE_LABEL: Partial<Record<EvidenceSourceKind, string>> = {
  website: "Deployment",
  repository: "Repository",
  document: "Document",
};

/** Evidence reference prefixes, so a cross-check can cite the exact location. */
const CROSS_REF_PREFIX: Partial<Record<EvidenceSourceKind, string>> = {
  website: "Deployed page:",
  repository: "GitHub:",
};

/**
 * Which part of the evidence carried a claim, and which part could not be read.
 *
 * This restates the comparison's own result per source — it never upgrades a
 * claim: a source that was not read stays “could not verify” even when the claim
 * is supported somewhere else, and a source that was read without a match says
 * so instead of implying the claim is false.
 */
function crossChecksFor(
  claim: ClaimCheck,
  sources: readonly EvidenceSourceReport[],
): ClaimCrossCheck[] {
  const supported = claim.status === "supported" || claim.status === "partially_supported";

  return sources
    .filter((source) => CROSS_SOURCE_LABEL[source.kind] !== undefined)
    .map((source) => {
      const label = CROSS_SOURCE_LABEL[source.kind] ?? source.label;
      const prefix = CROSS_REF_PREFIX[source.kind];
      const refs = prefix ? (claim.evidenceRefs ?? []).filter((ref) => ref.startsWith(prefix)) : [];

      if (!source.readable) {
        return {
          source: label,
          status: "could_not_verify" as ClaimEvidenceStatus,
          detail: `${source.label} could not be read, so this source was not checked.`,
        };
      }
      // A deck claim is not verified by the deck: the deck is where the team
      // said it. Saying so is clearer than reporting a comparison that never ran.
      if (source.kind === "document" && claim.id.startsWith("deck.")) {
        return {
          source: label,
          status: "could_not_verify" as ClaimEvidenceStatus,
          detail:
            "The deck is where this claim came from, so it does not count as proof — it is checked against the code and the live app.",
        };
      }
      if (supported && claim.sources.includes(source.kind)) {
        return {
          source: label,
          status: "supported" as ClaimEvidenceStatus,
          detail: refs[0]
            ? `Matching evidence found: ${refs[0]}`
            : `${source.label} carries evidence for this claim.`,
        };
      }
      if (claim.status === "not_found") {
        return {
          source: label,
          status: "not_found" as ClaimEvidenceStatus,
          detail: `${source.label} was read and did not show this claim.`,
        };
      }
      if (claim.status === "could_not_verify") {
        return {
          source: label,
          status: "could_not_verify" as ClaimEvidenceStatus,
          detail: `This claim could not be checked against ${source.label.toLowerCase()}.`,
        };
      }
      return {
        source: label,
        status: "not_found" as ClaimEvidenceStatus,
        detail: `No matching evidence for this claim in ${source.label}.`,
      };
    });
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
      crossChecks: crossChecksFor(claim, bundle.sources),
    };
  });
}

/* ----------------------------------------------------------------- sections */

function documentSection(
  detail: ProjectDetail,
  bundle: EvidenceBundle | null,
  mismatch: DocumentMismatch,
): InspectionSection {
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
    id: "document.mismatch",
    section: "document",
    title: "Does the deck describe this project?",
    result: MISMATCH_LEVEL_LABELS[mismatch.level],
    status:
      mismatch.level === "major" ? "critical" : mismatch.level === "possible" ? "warning" : "good",
    explanation:
      mismatch.level === "none"
        ? mismatch.headline
        : `${mismatch.headline} ${mismatch.signals.map((signal) => signal.detail).join(" ")}`,
    evidence: [...mismatch.evidence, ...mismatch.signals.map((signal) => signal.label)].slice(0, 8),
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
    evidence: withPages.map(
      (claim) => `p.${(claim.pageRefs ?? []).join(", ")} — ${clip(claim.claim, 90)}`,
    ),
    confidence: withPages.length > 0 ? "high" : "low",
  });

  if (source.highlights.some((highlight) => /ocr/i.test(highlight))) {
    checks.push({
      id: "document.ocr",
      section: "document",
      title: "Scanned pages / OCR",
      result: "OCR was used for at least part of the document",
      status: "info",
      explanation:
        "Text on image-only pages was read with OCR, so it may contain recognition errors.",
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
      status:
        flag.severity === "high" ? "critical" : flag.severity === "medium" ? "warning" : "info",
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

  const scored = checks.filter(
    (check) => check.id.startsWith("rubric.") && check.result.includes("/100"),
  );
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

function judgeBullets(input: {
  type: ProjectType;
  counts: ClaimCounts & { total: number };
  checks: readonly InspectionCheck[];
  bundle: EvidenceBundle | null;
  detail: ProjectDetail;
  tone: VerdictTone;
  missingInputs: string[];
}): string[] {
  const { counts, checks, bundle, detail, tone, missingInputs } = input;
  const bullets: string[] = [];

  if (counts.total > 0) {
    const unverified = counts.partially_supported + counts.not_found + counts.could_not_verify;
    bullets.push(
      unverified === 0
        ? `✓ All ${counts.total} checked claims are backed by the evidence that was read.`
        : `⚠ ${counts.supported} of ${counts.total} claims are fully supported; ${unverified} need${unverified === 1 ? "s" : ""} closer attention.`,
    );
  } else {
    bullets.push("• No checkable claims were submitted, so claim verification could not run.");
  }

  const site = bundle?.sources.find((source) => source.kind === "website") ?? null;
  if (detail.demoUrl) {
    bullets.push(
      site?.readable
        ? `✓ The deployed application was reached and inspected.`
        : `⚠ The submitted deployment could not be read, so live behaviour is unverified.`,
    );
  } else if (requiredInputs(input.type).website) {
    bullets.push("⚠ No deployed URL was submitted, so the live application is unverified.");
  }

  const repo = bundle?.sources.find((source) => source.kind === "repository") ?? null;
  if (repo?.readable) {
    const tests = (repo.observations ?? []).find((entry) => entry.id === "repo.code.tests");
    bullets.push(
      tests?.status === "good"
        ? "✓ The repository contains implementation evidence, including automated tests."
        : "⚠ The repository was read, but no automated tests were found.",
    );
  } else if (detail.repoUrl) {
    bullets.push("⚠ The repository could not be read, so implementation evidence is unverified.");
  }

  const critical = checks.filter((check) => check.status === "critical");
  if (critical.length > 0) {
    bullets.push(`✕ ${clip(critical[0]?.explanation ?? "A critical finding needs review.", 130)}`);
  } else {
    const security = checks.filter(
      (check) => check.section === "security" && check.status === "warning",
    );
    bullets.push(
      security.length > 0
        ? `⚠ Security: ${clip(security[0]?.title ?? "one check", 60)} needs the judge's attention.`
        : "✓ No critical security finding was detected in the public sources (server-side security was not tested).",
    );
  }

  if (missingInputs.length > 0 && bullets.length < 5) {
    bullets.push(`⚠ ${missingInputs[0]}`);
  } else if (tone === "unverified" && bullets.length < 5) {
    bullets.push("⚠ Too little could be read to verify the project — ask the team for a demo.");
  }

  return bullets.slice(0, 5);
}

/** Which deployment area an observation belongs to. Non-web areas are ignored. */
const DEPLOYMENT_AREA_OF: Record<ObservationArea, DeploymentAreaId | null> = {
  accessibility: "availability",
  functionality: "functionality",
  performance: "performance",
  security: "security",
  ux: "responsiveness",
  repository: null,
  document: null,
  evaluation: null,
};

const HTTP_STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No content",
  301: "Moved permanently",
  302: "Found",
  304: "Not modified",
  307: "Temporary redirect",
  308: "Permanent redirect",
  400: "Bad request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not found",
  405: "Method not allowed",
  429: "Too many requests",
  500: "Server error",
  502: "Bad gateway",
  503: "Service unavailable",
  504: "Gateway timeout",
};

function httpText(status: number): string {
  return `${status} ${HTTP_STATUS_TEXT[status] ?? "Response"}`;
}

/** How a finding was reached — never upgraded beyond what the reader did. */
function deploymentBasis(status: CheckStatus): DeploymentBasis {
  if (status === "not_detected" || status === "not_found") return "not_detected";
  if (status === "could_not_verify") return "could_not_verify";
  return "observed";
}

function deploymentAreaStatus(checks: DeploymentCheck[]): CheckStatus {
  if (checks.length === 0) return "could_not_verify";
  if (checks.some((check) => check.status === "critical")) return "critical";
  if (checks.some((check) => check.status === "warning")) return "warning";
  if (checks.some((check) => check.status === "good" || check.status === "supported")) {
    return "good";
  }
  if (checks.every((check) => check.status === "could_not_verify")) return "could_not_verify";
  return "not_detected";
}

function evidenceNumber(entry: EvidenceObservation, pattern: RegExp): number | null {
  const match = pattern.exec(entry.evidence.join(" "));
  return match?.[1] ? Number(match[1]) : null;
}

/**
 * The short value shown beside a deployment check (“200 OK”, “420 ms”, “2 failed”).
 * Each case reads a measurement the reader already recorded; the default falls
 * back to the first sentence of the finding rather than inventing a value.
 */
function deploymentValue(entry: EvidenceObservation): string {
  switch (entry.id) {
    case "site.accessibility.reachable":
      return entry.status === "good"
        ? "Online"
        : entry.status === "critical"
          ? "Server error"
          : "Error response";
    case "site.accessibility.https":
      return entry.status === "good"
        ? "Enabled"
        : entry.status === "critical"
          ? "Plain HTTP"
          : "Not checked";
    case "site.accessibility.status": {
      const status = evidenceNumber(entry, /HTTP (\d{3})/);
      return status === null ? headlineOf(entry.result, 48) : httpText(status);
    }
    case "site.accessibility.redirects": {
      const hops = Math.max(0, entry.evidence.length - 1);
      return `${hops} redirect${hops === 1 ? "" : "s"}`;
    }
    case "site.performance.response": {
      const ms = evidenceNumber(entry, /in (\d+)ms/);
      return ms === null ? headlineOf(entry.result, 48) : `${ms} ms`;
    }
    case "site.performance.failed_resources":
      return `${entry.evidence.length} failed`;
    case "site.performance.large_assets":
      return `${entry.evidence.length} large`;
    case "site.performance.html_size": {
      const bytes = evidenceNumber(entry, /^(\d+) bytes of HTML$/);
      return bytes === null ? headlineOf(entry.result, 48) : `${Math.round(bytes / 1024)} KB`;
    }
    case "site.performance.assets":
      return `${entry.evidence.length} sampled`;
    case "site.performance.lighthouse":
      return "Not run";
    case "site.functionality.content":
      return entry.status === "warning" ? "Needs review" : "Rendered content";
    case "site.functionality.links": {
      if (entry.status === "could_not_verify") return "Not checked";
      const failed = entry.evidence.filter((line) => / — (?!2|3\d{2}\b)/.test(line)).length;
      return failed === 0 ? "All responded" : `${failed} failed`;
    }
    case "site.functionality.interactions": {
      const total = entry.evidence.reduce((sum, line) => {
        const match = /: (\d+)$/.exec(line);
        return sum + (match?.[1] ? Number(match[1]) : 0);
      }, 0);
      return `${total} control${total === 1 ? "" : "s"}`;
    }
    case "site.functionality.flows":
      return "Not exercised";
    case "site.functionality.auth":
      return entry.status === "good" ? "Entry point found" : "Not visible";
    case "site.security.headers": {
      const missing = entry.evidence.filter((line) => /: not sent$/.test(line)).length;
      const total = entry.evidence.length;
      return `${total - missing} of ${total} present`;
    }
    case "site.security.mixed_content":
      return entry.status === "not_detected" ? "Not detected" : `${entry.evidence.length} found`;
    case "site.security.secrets":
      return entry.status === "not_detected" ? "None detected" : `${entry.evidence.length} pattern`;
    case "site.security.server_side":
      return "Not tested";
    case "site.ux.viewport":
      return entry.status === "good" ? "Present" : "Missing";
    case "site.ux.metadata":
      return entry.status === "good" ? "Title + description" : "Incomplete";
    case "site.ux.images":
      return entry.status === "could_not_verify"
        ? "No images"
        : `${entry.evidence.length} without alt`;
    case "site.ux.layout":
      return "Not inspected";
    default:
      return headlineOf(entry.result, 48);
  }
}

/** The five areas, built straight from the observations the site reader recorded. */
function deploymentAreas(observations: EvidenceObservation[]): DeploymentArea[] {
  return DEPLOYMENT_AREA_IDS.map((id) => {
    const checks: DeploymentCheck[] = observations
      .filter((entry) => DEPLOYMENT_AREA_OF[entry.area] === id)
      .map((entry) => ({
        id: entry.id,
        label: entry.label,
        status: entry.status,
        basis: deploymentBasis(entry.status),
        value: deploymentValue(entry),
        detail: entry.result,
        evidence: entry.evidence,
        confidence: entry.confidence,
      }));
    return { id, label: DEPLOYMENT_AREA_LABELS[id], status: deploymentAreaStatus(checks), checks };
  }).filter((area) => area.checks.length > 0);
}

/** The HTTP facts behind the inspection — null where nothing was measured. */
function deploymentHttp(site: EvidenceSourceReport | null): DeploymentHttp {
  const observations = site?.observations ?? [];
  const find = (id: string) => observations.find((entry) => entry.id === id) ?? null;
  const statusObs = find("site.accessibility.status");
  const httpsObs = find("site.accessibility.https");
  const redirectObs = find("site.accessibility.redirects");
  const finalUrlLine = httpsObs?.evidence.find((line) => line.startsWith("Final URL:"));

  return {
    status: statusObs ? evidenceNumber(statusObs, /HTTP (\d{3})/) : null,
    finalUrl: finalUrlLine ? finalUrlLine.replace("Final URL:", "").trim() : (site?.url ?? null),
    https: httpsObs ? httpsObs.status === "good" : null,
    redirects: redirectObs ? Math.max(0, redirectObs.evidence.length - 1) : null,
    redirectChain: redirectObs?.evidence ?? [],
    responseMs: statusObs ? evidenceNumber(statusObs, /Total time (\d+)ms/) : null,
  };
}

function buildDeployment(
  detail: ProjectDetail,
  bundle: EvidenceBundle | null,
  type: ProjectType,
  generatedAt: string,
): DeploymentInspection {
  const site = bundle?.sources.find((source) => source.kind === "website") ?? null;
  const needsSite = requiredInputs(type).website;
  const observations = site?.observations ?? [];
  const find = (id: string) => observations.find((entry) => entry.id === id) ?? null;

  const httpsObs = find("site.accessibility.https");
  const statusObs = find("site.accessibility.status");
  const reachableObs = find("site.accessibility.reachable");
  const secretsObs = find("site.security.secrets");
  const headersObs = find("site.security.headers");
  const linksObs = find("site.functionality.links");
  const failedObs = find("site.performance.failed_resources");
  const largeObs = find("site.performance.large_assets");

  const http = deploymentHttp(site);
  const areas = deploymentAreas(observations);
  const areaStatus = (id: DeploymentAreaId): CheckStatus =>
    areas.find((area) => area.id === id)?.status ?? "could_not_verify";

  const row = (
    id: DeploymentRowId,
    label: string,
    status: CheckStatus,
    value: string,
    detail: string,
  ): DeploymentRow => ({ id, label, status, value, detail });

  const accessibility = (() => {
    if (!site || !site.readable) {
      if (!detail.demoUrl)
        return row(
          "availability",
          "Availability",
          "could_not_verify",
          "Not checked",
          needsSite
            ? "No deployed URL was submitted, so the live application was not inspected. That is a gap in the evidence, not proof that the app does not work."
            : `A ${PROJECT_TYPE_LABELS[type].toLowerCase()} does not need a deployed website, so this is not counted against the project.`,
        );
      return row(
        "availability",
        "Availability",
        "could_not_verify",
        "Not checked",
        site?.detail ??
          "The submitted URL was reachable in principle but the page itself could not be read, so live availability is unverified.",
      );
    }
    if (reachableObs?.status === "critical") {
      return row(
        "availability",
        "Availability",
        "critical",
        http.status !== null && http.status >= 500 ? "Server error" : "Not reachable",
        reachableObs.result,
      );
    }
    if (reachableObs?.status === "warning") {
      return row("availability", "Availability", "warning", "Error response", reachableObs.result);
    }
    return row(
      "availability",
      "Availability",
      "good",
      "Online",
      reachableObs ? reachableObs.result : "The page was reached during inspection.",
    );
  })();

  const https = httpsObs
    ? row("https", "HTTPS", httpsObs.status, deploymentValue(httpsObs), httpsObs.result)
    : site && site.readable
      ? row(
          "https",
          "HTTPS",
          "could_not_verify",
          "Not checked",
          "HTTPS was not readable from the page that was served.",
        )
      : row(
          "https",
          "HTTPS",
          "could_not_verify",
          "Not checked",
          "No page could be read to check HTTPS.",
        );

  const response = statusObs
    ? row(
        "response",
        "Page response",
        statusObs.status,
        deploymentValue(statusObs),
        statusObs.result,
      )
    : site && site.readable
      ? row(
          "response",
          "Page response",
          "could_not_verify",
          "Not measured",
          "No HTTP status was recorded for the served page.",
        )
      : row(
          "response",
          "Page response",
          "could_not_verify",
          "Not checked",
          "No page was served during inspection.",
        );

  const performanceChecks = areas.find((area) => area.id === "performance")?.checks ?? [];
  const performanceStatus = areaStatus("performance");
  const performanceNote =
    performanceChecks.find((check) => check.status === "warning")?.detail ??
    performanceChecks[0]?.detail ??
    "No performance measurement was taken — BuildLens reports only what it can measure, never a fabricated score.";
  const performance = row(
    "performance",
    "Performance",
    performanceStatus,
    performanceChecks.length === 0
      ? "Not measured"
      : performanceStatus === "warning"
        ? "Needs review"
        : performanceStatus === "good"
          ? "Good"
          : "Measured",
    performanceNote,
  );

  const functionalityChecks = areas.find((area) => area.id === "functionality")?.checks ?? [];
  const functionalityStatus = areaStatus("functionality");
  const functionalityNote =
    functionalityChecks.find((check) => check.id === "site.functionality.flows")?.detail ??
    functionalityChecks.find((check) => check.status === "warning")?.detail ??
    functionalityChecks[0]?.detail ??
    "The served page could be read, but no interactive functionality was directly tested.";
  const functionality = row(
    "functionality",
    "Functionality",
    functionalityStatus,
    functionalityStatus === "warning"
      ? "Needs review"
      : functionalityStatus === "good"
        ? "Main page working"
        : "Not inspected",
    functionalityNote,
  );

  // Security reads from the two checks that carry real weight here: exposed
  // secrets in public assets, then the response headers. Server-side security
  // is always “could not verify”, never a pass.
  const securityStatus: CheckStatus =
    secretsObs?.status === "critical"
      ? "critical"
      : headersObs?.status === "warning"
        ? "warning"
        : secretsObs || headersObs
          ? "not_detected"
          : "could_not_verify";
  const security = row(
    "security",
    "Security",
    securityStatus,
    securityStatus === "critical"
      ? "Possible exposed secret"
      : securityStatus === "warning"
        ? "Some headers missing"
        : securityStatus === "not_detected"
          ? "No obvious exposed secrets"
          : "Not inspected",
    [
      secretsObs?.result,
      headersObs?.result,
      "Server-side security (authorization, injection, data exposure) was not tested — a public page cannot show it.",
    ]
      .filter((line): line is string => Boolean(line))
      .join(" "),
  );

  const responsiveChecks = areas.find((area) => area.id === "responsiveness")?.checks ?? [];
  const mobileStatus = areaStatus("responsiveness");
  const mobile = row(
    "mobile",
    "Mobile / responsive",
    mobileStatus,
    mobileStatus === "good"
      ? "Viewport configured"
      : mobileStatus === "warning"
        ? "Needs review"
        : "Not measured",
    responsiveChecks[0]?.detail ?? "No responsive-layout signal was captured for the served page.",
  );

  const limitations: string[] = [];
  if (site && site.readable) {
    limitations.push(
      "Server-side security (authorization, injection, data exposure) was not tested — this is a public-page inspection, not a penetration test.",
    );
    limitations.push(
      "No Lighthouse or PageSpeed run is performed, so no performance score is reported; the measurements are raw observations.",
    );
    limitations.push(
      "Interactive flows were not clicked through: only the served landing page and its same-origin links were requested.",
    );
    limitations.push(
      "Layout, overflow and readability were not visually inspected; the markup was read, not rendered.",
    );
  }
  if (!needsSite) {
    limitations.push(
      `A ${PROJECT_TYPE_LABELS[type].toLowerCase()} does not require a deployed website; the repository and deck were inspected instead.`,
    );
  }

  return {
    applicable: needsSite,
    url: detail.demoUrl ?? null,
    checkedAt: generatedAt,
    rows: [accessibility, https, response, performance, functionality, security, mobile],
    areas,
    http,
    routes: linksObs?.evidence ?? [],
    resources: [...(failedObs?.evidence ?? []), ...(largeObs?.evidence ?? [])],
    observations: observations.map((entry) => entry.result),
    evidence: [detail.demoUrl].filter(Boolean) as string[],
    limitations,
  };
}

/** Findings from the verification layer turned back into inspection checks. */
function featureCheck(feature: FeatureVerification): InspectionCheck {
  const status: CheckStatus =
    feature.result === "supported"
      ? "supported"
      : feature.result === "partial"
        ? "partially_supported"
        : feature.result === "not_supported"
          ? "not_found"
          : "could_not_verify";

  return {
    id: feature.id,
    section: "functionality",
    title: feature.feature,
    result: VERIFICATION_RESULT_LABELS[feature.result],
    status,
    explanation: `${feature.note} Searched in: ${feature.searched.join(", ")}. Tested against the deployed application: ${feature.tested ? "yes" : "no"}.`,
    evidence: feature.evidence,
    confidence: "high",
  };
}

function riskCheck(finding: SecurityFinding): InspectionCheck {
  const status: CheckStatus =
    finding.severity === "critical" || finding.severity === "high"
      ? "critical"
      : finding.severity === "medium"
        ? "warning"
        : "info";

  return {
    id: `risk.${finding.id}`,
    section: "security",
    title: finding.title,
    result: `${SEVERITY_LABELS[finding.severity]} risk · ${finding.kind === "exposure" ? "exposure" : finding.kind === "policy" ? "policy recommendation" : "configuration"}`,
    status,
    explanation: finding.detail,
    evidence: finding.evidence,
    confidence: "high",
  };
}

/** Two to four sentences the judge reads before anything else. */
function buildExecutiveSummary(input: {
  counts: ClaimCounts & { total: number };
  mismatch: DocumentMismatch;
  features: ReturnType<typeof featureCounts>;
  security: SecurityAssessment;
  overallScore: number | null;
}): string {
  const sentences: string[] = [];

  if (input.overallScore === null) {
    sentences.push(
      "Nothing measurable could be read from this submission, so it could not be scored.",
    );
  } else if (input.counts.total === 0) {
    sentences.push(
      "No checkable claims were submitted, so only the sources themselves were inspected.",
    );
  } else if (input.counts.not_found + input.counts.partially_supported === 0) {
    sentences.push(
      `All ${input.counts.total} checked claims are backed by the sources that were read.`,
    );
  } else {
    sentences.push(
      `${input.counts.supported} of ${input.counts.total} checked claims are supported; ${input.counts.not_found} could not be found in the repository or the deployment and ${input.counts.partially_supported} are only partly backed.`,
    );
  }

  if (input.mismatch.level === "major") {
    sentences.push(
      "The submitted document describes a different product from the one that was submitted, which caps the overall score.",
    );
  } else if (input.mismatch.level === "possible") {
    sentences.push(
      "Part of the submitted document does not line up with the project that was actually submitted.",
    );
  }

  if (input.features.missing > 0) {
    sentences.push(
      `${input.features.missing} of ${input.features.total} claimed features were not found in the repository or the deployed application.`,
    );
  }

  if (input.security.counts.critical > 0) {
    sentences.push(
      "A credential appears to be exposed in the sources that were read; rotate it before judging the rest.",
    );
  } else if (input.security.counts.high > 0) {
    sentences.push(input.security.headline);
  }

  if (sentences.length < 2 && input.overallScore !== null) {
    sentences.push(
      "No unsupported claim, missing feature or exposed credential was detected in what was inspected.",
    );
  }

  return sentences.slice(0, 4).join(" ");
}

function buildVerdict(
  detail: ProjectDetail,
  bundle: EvidenceBundle | null,
  evaluation: StructuredEvaluation | null,
  sections: InspectionSection[],
  type: ProjectType,
  analysis: {
    features: FeatureVerification[];
    mismatch: DocumentMismatch;
    security: SecurityAssessment;
    deployment: DeploymentInspection;
  },
): JudgeVerdict {
  const { features, mismatch, security: assessment, deployment } = analysis;
  const counts: ClaimCounts & { total: number } = {
    ...(bundle?.counts ?? zeroCounts()),
    total: bundle?.claims.length ?? 0,
  };
  const checks = sections.flatMap((section) => section.checks);
  const readableVerification =
    bundle?.sources.filter(
      (source) => source.readable && (source.kind === "repository" || source.kind === "website"),
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

  const verified = claims
    .filter((claim) => claim.status === "supported")
    .map((claim) => short(claim.claim));
  const unverified = claims
    .filter((claim) => claim.status !== "supported")
    .map((claim) => `${short(claim.claim)} — ${CLAIM_STATUS_LABELS[claim.status].toLowerCase()}`);

  const breakdown = scoreEvaluation({
    claims,
    features,
    deployment,
    security: assessment,
    mismatch,
    bundle,
  });
  const featureSummary = featureCounts(features);

  /* Concerns are assembled from the evidence, then ordered by severity: what a
     judge has to act on comes first, and nothing appears twice. */
  const featureClaimIds = new Set(features.map((feature) => feature.id.replace(/^feature:/, "")));
  const concerns: JudgeConcern[] = [];
  const seenConcerns = new Set<string>();
  const addConcern = (text: string, severity: Severity) => {
    const key = text.toLowerCase().slice(0, 70);
    if (seenConcerns.has(key)) return;
    seenConcerns.add(key);
    concerns.push({ text: clip(text, 190), severity });
  };

  for (const signal of mismatch.signals) addConcern(signal.detail, signal.severity);

  for (const claim of claims) {
    if (claim.status !== "not_found" || featureClaimIds.has(claim.id)) continue;
    addConcern(
      `Claim not supported: ${short(claim.claim)}`,
      claim.kind === "ai" || claim.kind === "security" ? "high" : "medium",
    );
  }

  for (const feature of features) {
    if (feature.result !== "not_supported") continue;
    addConcern(
      `${feature.feature} was claimed but no matching implementation or deployed feature was found.`,
      feature.severity ?? "high",
    );
  }

  for (const finding of assessment.findings) {
    if (finding.kind === "exposure") {
      addConcern(`${finding.title}; ${finding.detail}`, finding.severity);
    }
  }

  for (const check of checks) {
    if (check.section === "claims" || check.section === "security") continue;
    if (check.status === "critical") {
      addConcern(`${check.title}: ${clip(check.result, 110)}`, "critical");
    }
  }

  for (const finding of assessment.findings) {
    if (finding.kind !== "exposure") {
      addConcern(`${finding.title} (${SEVERITY_LABELS[finding.severity]})`, finding.severity);
    }
  }

  concerns.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const keyConcerns = concerns.slice(0, 5);

  const severityCounts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const concern of concerns) severityCounts[concern.severity] += 1;

  const strengths = [
    ...features
      .filter((feature) => feature.result === "supported")
      .map(
        (feature) =>
          `${feature.feature} — verified${feature.tested ? " and observed in the deployed application" : " in the implementation"}`,
      ),
    ...checks
      .filter((check) => check.status === "good" && check.section !== "claims")
      .map((check) => `${check.title}: ${clip(check.result, 90)}`),
    ...verified.map((claim) => `Supported claim: ${claim}`),
  ].slice(0, 6);

  const problems = keyConcerns.map((concern) => concern.text);

  const security = [
    ...assessment.findings.map(
      (finding) => `${SEVERITY_LABELS[finding.severity]} — ${clip(finding.title, 110)}`,
    ),
    ...checks
      .filter((check) => check.section === "security")
      .map((check) => `${CHECK_STATUS_LABELS[check.status]} — ${clip(check.result, 110)}`),
  ].slice(0, 5);

  return {
    headline,
    tone,
    toneLabel: VERDICT_TONE_LABELS[tone],
    score: evaluation?.overallScore ?? null,
    overallScore: breakdown.overall,
    overallBand: scoreBand(breakdown.overall),
    breakdown,
    executiveSummary: buildExecutiveSummary({
      counts,
      mismatch,
      features: featureSummary,
      security: assessment,
      overallScore: breakdown.overall,
    }),
    keyConcerns,
    severityCounts,
    mismatch,
    features,
    featureSummary,
    aiAvailable: Boolean(evaluation),
    counts,
    claimed: claims.slice(0, 5).map((claim) => short(claim.claim)),
    verified: verified.slice(0, 5),
    unverified: unverified.slice(0, 5),
    problems,
    strengths,
    security,
    aiSummary: evaluation?.finalSummary.verdict ?? evaluation?.summary ?? null,
    judgeBullets: judgeBullets({
      type,
      counts,
      checks,
      bundle,
      detail,
      tone,
      missingInputs,
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
    hasReadableWebsite: sources.some((source) => source.kind === "website" && source.readable),
  });
  const type = detected.type;

  const counts = {
    ...(bundle?.counts ?? zeroCounts()),
    total: bundle?.claims.length ?? 0,
  };

  /* Verification layer: what was claimed vs. what was found and tested. */
  const claims = bundle?.claims ?? [];
  const features = buildFeatureVerification({ claims, bundle });
  const mismatch = assessDocumentMismatch({ detail, bundle, claims });
  const security = assessSecurity(bundle);
  const generatedAt = new Date().toISOString();
  const deployment = buildDeployment(detail, bundle, type, generatedAt);

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

  /* Risk findings and feature rows lead their sections: a judge reading the
     detail view should meet the exposure before the hardening note. */
  const riskChecks = security.findings.map(riskCheck);
  const securityBase = areaSection(
    "security",
    bundle,
    ["security"],
    "No security check could run because no site or repository was read.",
    "Submit a repository or deployed URL to inspect security signals.",
  );
  const securitySection =
    riskChecks.length > 0
      ? sectionOf(
          "security",
          [
            ...riskChecks,
            ...securityBase.checks.filter((check) => check.id !== "security.unavailable"),
          ],
          security.headline,
          securityBase.empty,
        )
      : securityBase;

  const functionalityBase = areaSection(
    "functionality",
    bundle,
    ["functionality", "ux"],
    "No functionality or UX signal could be collected from the sources that were read.",
    "Submit a deployed URL to inspect the public interface.",
  );
  const featureChecks = features.map(featureCheck);
  const functionalitySection =
    featureChecks.length > 0
      ? sectionOf(
          "functionality",
          [...featureChecks, ...functionalityBase.checks],
          `${featureChecks.length} claimed feature${featureChecks.length === 1 ? "" : "s"} were checked against the repository and the deployed application.`,
          functionalityBase.empty,
        )
      : functionalityBase;

  const sections: InspectionSection[] = [
    claimsSection,
    documentSection(detail, bundle, mismatch),
    repositorySection(bundle),
    deploymentSection(detail, bundle, type),
    securitySection,
    areaSection(
      "performance",
      bundle,
      ["performance"],
      "No performance measurement could run because no deployed page was read.",
      "Submit a deployed URL to measure response and asset behaviour.",
    ),
    functionalitySection,
    aiSection(evaluation, input.runError),
    rubricSection(evaluation),
    evidenceSection(bundle, counts),
  ];

  const verdict = buildVerdict(detail, bundle, evaluation, sections, type, {
    features,
    mismatch,
    security,
    deployment,
  });
  verdict.strategy =
    detected.reasons.length > 0
      ? `${PROJECT_TYPE_STRATEGY[type]} (${detected.reasons.join(" ")})`
      : PROJECT_TYPE_STRATEGY[type];

  return {
    generatedAt,
    projectType: type,
    projectTypeLabel: PROJECT_TYPE_LABELS[type],
    strategy: verdict.strategy,
    verdict,
    sections,
    sources,
    counts,
    features,
    mismatch,
    security,
    score: verdict.breakdown,
    ai: {
      available: Boolean(evaluation),
      model: evaluation?.model ?? null,
      unavailableReason: evaluation ? null : (input.runError ?? null),
    },
    disclaimer: bundle?.disclaimer ?? INSPECTION_DISCLAIMER,
  };
}
