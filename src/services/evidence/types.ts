/**
 * Unified evidence layer — types.
 *
 * One vocabulary for every source the platform can read, so the AI judge and
 * the judge UI speak the same language:
 *
 *   source   — what was actually read (repository, deployed site, deck,
 *              submission text) and, when it could not be read, why.
 *   claim    — a statement the TEAM makes, and the status that the readable
 *              evidence gives it.
 *
 * The four statuses are deliberately separate. `not_found` means "we read the
 * sources and did not see this"; `could_not_verify` means "we never got to look".
 * Neither means "false", and no status ever removes a project's right to be
 * judged on the material it submitted.
 */

import type { IngestionKind, IngestionStatus } from "@/services/ingestion/types";

/* ----------------------------------------------------------------- status */

export const CLAIM_EVIDENCE_STATUSES = [
  "supported",
  "partially_supported",
  "not_found",
  "could_not_verify",
] as const;

export type ClaimEvidenceStatus = (typeof CLAIM_EVIDENCE_STATUSES)[number];

export function isClaimEvidenceStatus(value: unknown): value is ClaimEvidenceStatus {
  return (
    typeof value === "string" && (CLAIM_EVIDENCE_STATUSES as readonly string[]).includes(value)
  );
}

export const CLAIM_STATUS_LABELS: Record<ClaimEvidenceStatus, string> = {
  supported: "Supported",
  partially_supported: "Partially supported",
  not_found: "Not found",
  could_not_verify: "Could not verify",
};

/** Shown wherever claim statuses appear — the anti-“unverified means false” rule. */
export const CLAIM_STATUS_DISCLAIMER =
  "“Could not verify” means the evidence source was unreachable or not provided — it is not a negative finding. “Not found” means the readable sources were checked and did not show the claim. Neither is proof that a claim is false; “Contradicted” is reserved for cases where the evidence actually conflicts with the claim.";

/**
 * The verdict a judge reads. It is derived from the status plus what each source
 * actually showed — never from the model.
 *
 *   verified          — sufficient evidence supports the claim
 *   partially_verified— part of the claim is supported
 *   unverified        — insufficient evidence (nothing read, or nothing shown)
 *   unsupported       — a quantified claim whose figure appears nowhere
 *   contradicted      — the evidence actually conflicts with the claim
 */
export const CLAIM_VERDICTS = [
  "verified",
  "partially_verified",
  "unverified",
  "unsupported",
  "contradicted",
] as const;

export type ClaimVerdict = (typeof CLAIM_VERDICTS)[number];

export const CLAIM_VERDICT_LABELS: Record<ClaimVerdict, string> = {
  verified: "Verified",
  partially_verified: "Partially verified",
  unverified: "Unverified",
  unsupported: "Unsupported",
  contradicted: "Contradicted",
};

/**
 * What a claim is about. Metadata is not a claim: it is candidate-provided
 * information that never enters the verification pipeline.
 */
export const CLAIM_TYPES = [
  "metadata",
  "problem",
  "solution",
  "feature",
  "technology",
  "impact",
  "security_performance",
  "general",
] as const;

export type ClaimType = (typeof CLAIM_TYPES)[number];

export const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  metadata: "Candidate metadata",
  problem: "Problem statement",
  solution: "Solution claim",
  feature: "Feature claim",
  technology: "Technology claim",
  impact: "Impact claim",
  security_performance: "Security / performance claim",
  general: "Project claim",
};

/** A fact the candidate stated about themselves, never independently verified. */
export interface CandidateFact {
  label: string;
  value: string;
  /** Where the candidate said it, e.g. `PPT — slide 1`. */
  source: string;
  page?: number;
}

/** What one verification source showed for a claim. */
export const CLAIM_SOURCE_FINDINGS = [
  "found",
  "partial",
  "not_found",
  "not_checked",
] as const;

export type ClaimSourceFinding = (typeof CLAIM_SOURCE_FINDINGS)[number];

export const CLAIM_SOURCE_FINDING_LABELS: Record<ClaimSourceFinding, string> = {
  found: "Found",
  partial: "Partial evidence",
  not_found: "Not found",
  not_checked: "Not checked",
};

/**
 * What a claim is about. Used to prioritise the claims a judge reads first and
 * to label them in the detailed analysis. Never used to change a status.
 */
export const CLAIM_KINDS = [
  "features",
  "technology",
  "ai",
  "security",
  "performance",
  "integrations",
  "functionality",
  "scalability",
  "deployment",
  "originality",
  "general",
] as const;

export type ClaimKind = (typeof CLAIM_KINDS)[number];

/* ----------------------------------------------------------- observations */

/**
 * Inspection areas. Each maps onto one section of the technical analysis:
 * accessibility/functionality → deployed app, security/performance → their own
 * sections, repository → code inspection, document → deck inspection.
 */
export const OBSERVATION_AREAS = [
  "accessibility",
  "functionality",
  "performance",
  "security",
  "ux",
  "repository",
  "document",
  "evaluation",
] as const;

export type ObservationArea = (typeof OBSERVATION_AREAS)[number];

/**
 * Observation status vocabulary. `not_detected` is deliberately different from
 * `good`: “no mixed content found” is not the same statement as “the site is
 * secure”, and `could_not_verify` means the check never ran.
 */
export const OBSERVATION_STATUSES = [
  "good",
  "warning",
  "critical",
  "not_detected",
  "could_not_verify",
  "info",
] as const;

export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];

export const OBSERVATION_STATUS_LABELS: Record<ObservationStatus, string> = {
  good: "Good",
  warning: "Warning",
  critical: "Critical",
  not_detected: "Not detected",
  could_not_verify: "Could not verify",
  info: "Observation",
};

/**
 * One thing the inspection checked, what it found, and the raw evidence behind
 * that result. Observations are produced by the source readers (never by the
 * model), so they can be shown next to the exact URL, header or file path.
 */
export interface EvidenceObservation {
  /** Stable id, e.g. `site.security.https` — never shown to users. */
  id: string;
  area: ObservationArea;
  /** What was checked, in plain language. */
  label: string;
  status: ObservationStatus;
  /** What was actually found (or could not be checked). */
  result: string;
  /** Exact URLs, headers, file paths or values behind the result. */
  evidence: string[];
  confidence: "high" | "medium" | "low";
}

/* ---------------------------------------------------------------- segments */

/**
 * Where a piece of evidence came from. Documentation (a README) is kept
 * separate on purpose: it may state a feature, but it never proves the feature
 * exists — only implementation, configuration or an observed page can.
 */
export const EVIDENCE_SEGMENT_KINDS = [
  "implementation",
  "config",
  "runtime",
  "documentation",
] as const;

export type EvidenceSegmentKind = (typeof EVIDENCE_SEGMENT_KINDS)[number];

export interface EvidenceSegment {
  /** Citation shown next to a finding, e.g. `GitHub: src/auth/login.ts`. */
  ref: string;
  kind: EvidenceSegmentKind;
  text: string;
}

/**
 * How a claim can be checked at all.
 *
 *   checkable    — asserts something implementation or a page can show
 *   subjective   — marketing/opinion (“seamless”, “world-class”)
 *   unmeasurable — value/impact statement with nothing measurable in it
 *
 * The last two are reported as COULD NOT VERIFY with a plain explanation, never
 * as NOT FOUND: the team did not fail a check that could exist.
 */
export const CLAIM_NATURES = ["checkable", "subjective", "unmeasurable"] as const;

export type ClaimNature = (typeof CLAIM_NATURES)[number];

/* ----------------------------------------------------------------- sources */

/** Every source kind the layer can read. `submission` is the form itself. */
export type EvidenceSourceKind = IngestionKind | "submission";

export interface EvidenceSourceReport {
  kind: EvidenceSourceKind;
  label: string;
  /** Same lifecycle language as ingestion: ingested / pending / failed. */
  status: IngestionStatus;
  /** True only when this source was actually READ (text or facts collected). */
  readable: boolean;
  url: string | null;
  detail: string;
  /** Human-readable facts, e.g. "TypeScript 75% · React detected". */
  highlights: string[];
  /** Structured checks behind the facts (deployment, security, repository, …). */
  observations?: EvidenceObservation[];
}

/* ------------------------------------------------------------------ claims */

export type ClaimCategory =
  "problem" | "solution" | "features" | "technology" | "impact" | "description";

export interface ClaimCheck {
  /** Stable id so the model can answer per claim without paraphrasing it. */
  id: string;
  claim: string;
  category: ClaimCategory;
  /** What the claim is about (features, security, AI usage, …). */
  kind?: ClaimKind;
  /** The judged vocabulary: problem / solution / feature / technology / … */
  claimType?: ClaimType;
  status: ClaimEvidenceStatus;
  /** What the judge reads: verified / partial / unverified / unsupported / contradicted. */
  verdict?: ClaimVerdict;
  /** Where the candidate said it, e.g. `PPT — slide 5`. */
  sourceRef?: string;
  /** What each readable source showed, one cell per column of the claim table. */
  bySource?: Partial<Record<"repository" | "website", ClaimSourceFinding>>;
  /** The conflicting evidence, when the verdict is CONTRADICTED. */
  contradiction?: string | null;
  /** Sources that either support the claim or were searched for it. */
  sources: EvidenceSourceKind[];
  /** Verbatim snippets from the readable sources (never invented). */
  quotes: string[];
  /** Slide/page numbers where the claim appears in the submitted deck. */
  pageRefs?: number[];
  /**
   * Where the evidence came from, ready to show the judge:
   * `GitHub: src/auth/login.ts`, `Deployed page: https://…`.
   * For NOT FOUND this lists what was searched instead.
   */
  evidenceRefs?: string[];
  /** Whether this claim was checkable at all (see CLAIM_NATURES). */
  nature?: ClaimNature;
  /** Why this status was assigned, in plain language. */
  note: string;
}

/* ------------------------------------------------------------------ bundle */

export interface EvidenceBundle {
  generatedAt: string;
  sources: EvidenceSourceReport[];
  claims: ClaimCheck[];
  /**
   * What the candidate stated about themselves (team ID, event, category).
   * Reported, never verified — deliberately kept out of `claims`.
   */
  candidateProvided?: CandidateFact[];
  /** Sources that were not readable, phrased as gaps (never as failures of the team). */
  gaps: string[];
  counts: Record<ClaimEvidenceStatus, number>;
  disclaimer: string;
}

/** Verdict counts, in the order the judge reads them. */
export function claimVerdictCounts(
  claims: readonly ClaimCheck[],
): Record<ClaimVerdict, number> {
  const counts: Record<ClaimVerdict, number> = {
    verified: 0,
    partially_verified: 0,
    unverified: 0,
    unsupported: 0,
    contradicted: 0,
  };
  for (const claim of claims) counts[verdictOf(claim)] += 1;
  return counts;
}

/** Stored bundles predate the verdict field: derive it from the status. */
export function verdictOf(claim: ClaimCheck): ClaimVerdict {
  if (claim.verdict) return claim.verdict;
  if (claim.status === "supported") return "verified";
  if (claim.status === "partially_supported") return "partially_verified";
  return "unverified";
}

/** Convenience for UI + scoring: how much of the claim set has real support. */
export function evidenceCounts(claims: readonly ClaimCheck[]): Record<ClaimEvidenceStatus, number> {
  const counts: Record<ClaimEvidenceStatus, number> = {
    supported: 0,
    partially_supported: 0,
    not_found: 0,
    could_not_verify: 0,
  };
  for (const claim of claims) counts[claim.status] += 1;
  return counts;
}
