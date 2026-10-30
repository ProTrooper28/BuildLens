/**
 * Verification model — the part of the evaluation that answers one question:
 *
 *   “Does what the team CLAIMED match what they BUILT?”
 *
 * Everything here is derived from evidence that was actually read (the evidence
 * bundle's sources and observations) plus the claims extracted from the deck.
 * Nothing in this layer calls a model: the same input always produces the same
 * verdicts and the same scores, which is what makes a judge able to trust them.
 *
 * Four vocabularies, deliberately separate:
 *
 *   Severity          how much a finding should change a decision
 *   VerificationResult what happened to one feature (found / tested / absent)
 *   DocumentMismatch  whether the submitted deck describes this project at all
 *   DimensionScore    one deterministic number with its weight and its reason
 */

/* ---------------------------------------------------------------- severity */

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;

export type Severity = (typeof SEVERITIES)[number];

/** Reading order: most severe first. */
export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const SEVERITY_MARKS: Record<Severity, string> = {
  critical: "✕",
  high: "✕",
  medium: "⚠",
  low: "•",
};

/* ---------------------------------------------------------------- features */

/**
 * What happened to one claimed feature.
 *
 * `tested` is only true when BuildLens actually read the deployed application
 * and saw the feature in what was served. It never means “we clicked through the
 * flow” — the note on every row says what was and was not done.
 */
export type VerificationResult = "supported" | "partial" | "not_supported" | "could_not_verify";

export const VERIFICATION_RESULT_LABELS: Record<VerificationResult, string> = {
  supported: "Supported",
  partial: "Partially supported",
  not_supported: "Not supported",
  could_not_verify: "Could not verify",
};

export interface FeatureVerification {
  id: string;
  /** The feature as the team claimed it, clipped for a table cell. */
  feature: string;
  /** Full claim text, for the expanded row. */
  claim: string;
  /** Where the claim came from (the deck is the usual source). */
  source: "deck" | "submission" | "readme";
  /** True when the feature exists as a claim at all (always true — it is a claim row). */
  claimed: boolean;
  /** Implementation or page evidence exists for it. */
  found: boolean;
  /** The deployed application was read and showed it. */
  tested: boolean;
  result: VerificationResult;
  /** Severity of a negative result; null when nothing is wrong. */
  severity: Severity | null;
  /** Exact files / URLs / page numbers behind the row. */
  evidence: string[];
  /** Which channels were searched, e.g. ["Repository", "Deployment"]. */
  searched: string[];
  /** One sentence, plain language, no inference presented as fact. */
  note: string;
}

/* --------------------------------------------------------------- mismatch */

export type MismatchLevel = "none" | "possible" | "major";

export interface MismatchSignal {
  id: string;
  label: string;
  detail: string;
  /** 1 = suggestive, 2 = strong, 3 = decisive on its own. */
  weight: 1 | 2 | 3;
  severity: Severity;
}

export interface DocumentMismatch {
  level: MismatchLevel;
  /** 0 = the deck describes this project; 100 = it describes something else. */
  score: number;
  headline: string;
  signals: MismatchSignal[];
  /** Only observed facts: URLs, names, counts. No interpretation. */
  evidence: string[];
}

/* ---------------------------------------------------------------- security */

export type SecurityFindingKind = "exposure" | "configuration" | "policy";

export interface SecurityFinding {
  id: string;
  title: string;
  severity: Severity;
  kind: SecurityFindingKind;
  /** What was found, without ever printing a secret value. */
  detail: string;
  /** Safe evidence: file paths, header names, pattern labels. */
  evidence: string[];
}

export interface SecurityAssessment {
  /** 0–100, or null when no security source could be read. */
  score: number | null;
  findings: SecurityFinding[];
  counts: Record<Severity, number>;
  /** The single sentence a judge should read. */
  headline: string;
  /** What was *not* tested — never presented as a pass. */
  limitations: string[];
}

/* ------------------------------------------------------------------ scores */

export const DIMENSION_IDS = [
  "claimVerification",
  "featureFunctionality",
  "deployment",
  "security",
  "technicalQuality",
  "performance",
  "testing",
  "documentation",
] as const;

export type DimensionId = (typeof DIMENSION_IDS)[number];

export const DIMENSION_LABELS: Record<DimensionId, string> = {
  claimVerification: "Claim verification",
  featureFunctionality: "Feature functionality",
  deployment: "Deployment",
  security: "Security",
  technicalQuality: "Technical quality",
  performance: "Performance",
  testing: "Testing",
  documentation: "Documentation",
};

/** How a dimension was reached — shown next to every number. */
export type ScoreBasis = "measured" | "derived" | "not_measured";

export interface DimensionScore {
  id: DimensionId;
  label: string;
  /** 0–100, or null when there was nothing to measure. */
  score: number | null;
  weight: number;
  basis: ScoreBasis;
  /** One sentence: what produced this number. */
  reason: string;
}

export interface ScoreCap {
  reason: string;
  cap: number;
}

export interface ScoreBreakdown {
  /** Weighted overall, after caps. Null when nothing could be scored. */
  overall: number | null;
  dimensions: DimensionScore[];
  caps: ScoreCap[];
  weights: Record<DimensionId, number>;
}
