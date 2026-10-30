/**
 * Normalized claim format — one structure for every claim the evaluator holds,
 * wherever it came from (deck, README, repository).
 *
 * A CLAIM is something the team says. EVIDENCE is what was found in the
 * repository, the deployed site or the document. The two are kept apart
 * deliberately: a claim's presence in a PPT or README never makes it true, so
 * `verificationStatus` is only ever filled from inspected evidence.
 */

export const CLAIM_SOURCES = ["PPT", "PDF", "README", "REPOSITORY", "SUBMISSION"] as const;

export type ClaimSource = (typeof CLAIM_SOURCES)[number];

export type ClaimCategory =
  | "problem"
  | "solution"
  | "feature"
  | "workflow"
  | "technology"
  | "architecture"
  | "performance"
  | "security"
  | "impact"
  | "description";

/**
 * Verification verdict for one claim.
 *
 * `unverified`        — extracted, not yet run through verification
 * `supported`         — found in inspected evidence (implementation and/or live)
 * `partial`           — some signal found, but not the whole claim / not exercised
 * `unsupported`       — the inspected sources were searched and did not show it
 * `could_not_verify`  — the evidence needed to decide was not available
 */
export const CLAIM_VERIFICATION_STATUSES = [
  "unverified",
  "supported",
  "partial",
  "unsupported",
  "could_not_verify",
] as const;

export type ClaimVerificationStatus = (typeof CLAIM_VERIFICATION_STATUSES)[number];

export const CLAIM_VERIFICATION_LABELS: Record<ClaimVerificationStatus, string> = {
  unverified: "Unverified",
  supported: "Supported",
  partial: "Partially supported",
  unsupported: "Not supported",
  could_not_verify: "Could not verify",
};

/** One place a claim was found. Deduplication merges several of these. */
export interface ClaimSourceRef {
  source: ClaimSource;
  /** `Slide 6`, `README.md — Features`, `submission form`, … */
  location: string | null;
}

export interface NormalizedClaim {
  id: string;
  claim: string;
  /** Primary source (the first one seen — deck claims read first). */
  source: ClaimSource;
  sourceLocation: string | null;
  /** Every source this claim appeared in, after deduplication. */
  sources: ClaimSourceRef[];
  /** Safe, observable evidence behind the verdict — never a restated claim. */
  evidence: string;
  category: ClaimCategory;
  /** How certainly the text is an actual claim (0–1), deterministic per source. */
  confidence: number;
  verificationStatus: ClaimVerificationStatus;
  verificationReason: string;
}

/** Counts a judge reads at a glance. */
export interface ClaimCounts {
  total: number;
  supported: number;
  partial: number;
  unsupported: number;
  could_not_verify: number;
  unverified: number;
}

/**
 * Registration/debug bookkeeping for one analysis run. `log` carries the
 * human-readable pipeline lines (`[PPT] extracted 9 claims`, …) so they can be
 * emitted and asserted without reading the payload.
 */
export interface ClaimPipelineStats {
  /** Claims found in the submitted PPT/PDF. */
  deck: number;
  /** Claims found in the repository README/documentation. */
  readme: number;
  /** Claims found in other repository documentation. */
  repository: number;
  /** Total extracted before deduplication. */
  extracted: number;
  /** Claims merged into another claim (same statement, several sources). */
  deduped: number;
  /** Claims that reached the report — must equal `extracted - deduped`. */
  registered: number;
  /** Claims whose verification produced a decision (supported/partial/unsupported). */
  verified: number;
  /** Points this claim set pulls off the overall score (0 or negative). */
  deduction: number;
  /** Set when extraction found claims but registration kept none (pipeline bug). */
  error: string | null;
  log: string[];
}

export const EMPTY_CLAIM_STATS: ClaimPipelineStats = {
  deck: 0,
  readme: 0,
  repository: 0,
  extracted: 0,
  deduped: 0,
  registered: 0,
  verified: 0,
  deduction: 0,
  error: null,
  log: [],
};

/**
 * Report-generation guard (never show "no claims" when claims exist):
 * extraction succeeded but registration lost every claim → a pipeline error,
 * not an empty state.
 */
export function claimRegistrationError(extracted: number, registered: number): string | null {
  if (extracted > 0 && registered === 0) {
    return "Claims were extracted but were not registered for verification.";
  }
  return null;
}

export function countClaims(claims: readonly NormalizedClaim[]): ClaimCounts {
  const counts: ClaimCounts = {
    total: claims.length,
    supported: 0,
    partial: 0,
    unsupported: 0,
    could_not_verify: 0,
    unverified: 0,
  };
  for (const claim of claims) counts[claim.verificationStatus] += 1;
  return counts;
}
