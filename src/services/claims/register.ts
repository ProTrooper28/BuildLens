/**
 * Claim registration — the step between "extracted" and "reported".
 *
 * Registration takes every normalized claim, deduplicates it, and gives it a
 * verdict from evidence that was actually inspected:
 *
 *   IMPLEMENTATION EVIDENCE — repository file tree, detected stack, README text
 *   RUNTIME EVIDENCE        — the deployed application (when it was inspected)
 *
 * The README and the deck are CLAIM SOURCES, never evidence, so a claim found
 * only in the README is never `supported`. Nothing here calls a model: the same
 * evidence always produces the same verdicts and the same score.
 */

import { claimsFromDocument, claimsFromReadme, dedupeClaims } from "./extract";
import type { ClaimPipelineStats, ClaimVerificationStatus, NormalizedClaim } from "./types";
import { claimRegistrationError, countClaims } from "./types";

export interface ClaimEvidenceSignals {
  /** Every path in the inspected repository tree (directories included). */
  filePaths: readonly string[];
  /** Detected frameworks, e.g. `React`, `Vite`. */
  frameworks: readonly string[];
  /** Detected languages, e.g. `TypeScript`. */
  languages: readonly string[];
  /** Raw README text, when it was downloaded. */
  readmeText: string | null;
  /** Deployed URL, when the runtime inspection ran. */
  liveEvidence: readonly string[];
}

export interface RegisterClaimsInput {
  document: import("@/services/document/types").DocumentAnalysis | null;
  readme: { path: string; text: string } | null;
  signals: ClaimEvidenceSignals;
}

export interface RegisteredClaims {
  claims: NormalizedClaim[];
  stats: ClaimPipelineStats;
}

/* ---------------------------------------------------------- verification */

const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "because",
  "before",
  "being",
  "between",
  "could",
  "every",
  "from",
  "have",
  "into",
  "itself",
  "more",
  "other",
  "over",
  "such",
  "than",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "under",
  "very",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
  "your",
  "youre",
  "using",
  "used",
  "uses",
  "also",
  "only",
  "does",
  "give",
  "given",
  "make",
  "made",
  "allows",
  "provide",
  "provides",
  "support",
  "supports",
  "built",
  "application",
  "app",
  "project",
  "users",
  "team",
  "we",
  "our",
]);

/** Significant words from a claim, used to look for implementation evidence. */
function claimKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));
}

const isDocumentationPath = (path: string) =>
  /(^|\/)(docs?|readme)\b/i.test(path) || /\.mdx?$/i.test(path);

/** Split keyword hits into implementation files and documentation files. */
function matchPaths(
  keywords: readonly string[],
  filePaths: readonly string[],
): { implementation: string[]; documentation: string[] } {
  const implementation: string[] = [];
  const documentation: string[] = [];
  if (keywords.length === 0) return { implementation, documentation };
  for (const path of filePaths) {
    const lower = path.toLowerCase();
    if (!keywords.some((keyword) => lower.includes(keyword))) continue;
    if (isDocumentationPath(path)) documentation.push(path);
    else implementation.push(path);
  }
  return { implementation, documentation };
}

interface Verdict {
  status: ClaimVerificationStatus;
  reason: string;
  evidence: string;
}

const NOT_RUN = "the analysis does not execute the application";

/**
 * Deterministic verdict for one claim against the inspected evidence.
 *
 * Only implementation files can move a feature claim up; README text alone
 * never does (a claim in the README is still a claim). Runtime evidence wins
 * when it exists.
 */
function verifyClaim(claim: NormalizedClaim, signals: ClaimEvidenceSignals): Verdict {
  const keywords = claimKeywords(claim.claim);
  const matches = matchPaths(keywords, signals.filePaths);
  const live = signals.liveEvidence.filter((line) =>
    keywords.some((keyword) => line.toLowerCase().includes(keyword)),
  );

  if (live.length > 0) {
    return {
      status: "supported",
      reason: "The deployed application was inspected and showed this.",
      evidence: `Runtime: ${live.slice(0, 2).join(" · ")}`,
    };
  }

  if (claim.category === "technology") {
    const detected = [...signals.frameworks, ...signals.languages].filter((name) =>
      claim.claim.toLowerCase().includes(name.toLowerCase()),
    );
    if (detected.length > 0) {
      return {
        status: "supported",
        reason: "Detected in the inspected repository.",
        evidence: `Implementation: ${detected.slice(0, 3).join(", ")} declared in the repository.`,
      };
    }
    if (matches.implementation.length > 0) {
      return {
        status: "partial",
        reason:
          "Related implementation files exist, but the technology was not detected as a declared dependency.",
        evidence: `Implementation: ${matches.implementation.slice(0, 3).join(", ")}`,
      };
    }
    return {
      status: "unsupported",
      reason: "Not detected in the inspected stack, languages or file tree.",
      evidence: `Searched ${signals.filePaths.length} repository paths, the detected stack and the README.`,
    };
  }

  if (matches.implementation.length > 0) {
    return {
      status: "partial",
      reason: `A matching implementation file was found, but ${NOT_RUN}, so the claim was not exercised end to end.`,
      evidence: `Implementation: ${matches.implementation.slice(0, 3).join(", ")}`,
    };
  }

  if (matches.documentation.length > 0) {
    return {
      status: "could_not_verify",
      reason:
        "Only documentation mentions this. The README is a claim source, so it was not counted as proof.",
      evidence: `Documentation: ${matches.documentation.slice(0, 3).join(", ")}`,
    };
  }

  // Nothing matched in the implementation tree.
  //  · a README-sourced claim stays COULD NOT VERIFY: a path search cannot
  //    refute what the team wrote in their own documentation.
  //  · a deck claim that the README also states gets the same verdict — two
  //    claim sources agreeing is still not implementation evidence.
  //  · a deck claim with no backing anywhere becomes NOT SUPPORTED, with the
  //    exact search scope spelled out.
  const implemented =
    claim.category === "feature" ||
    claim.category === "workflow" ||
    claim.category === "architecture" ||
    claim.category === "security" ||
    claim.category === "performance";

  if (!implemented) {
    return {
      status: "could_not_verify",
      reason:
        claim.category === "impact"
          ? "Impact claims need usage data the submission did not provide."
          : claim.category === "problem"
            ? "Problem framing cannot be confirmed by repository inspection."
            : "This is a framing claim; repository inspection cannot confirm or refute it.",
      evidence: `Searched ${signals.filePaths.length} repository paths and the README.`,
    };
  }

  const scope = `Searched ${signals.filePaths.length} repository paths${
    signals.readmeText ? " and the README" : ""
  }${signals.liveEvidence.length === 0 ? " — the deployed application was not inspected" : ""}`;

  const fromReadme = claim.sources.some((source) => source.source === "README");
  if (fromReadme) {
    return {
      status: "could_not_verify",
      reason:
        "The claim comes from the README, which is a claim source. No matching implementation file was found in the inspected repository, and the application was not executed.",
      evidence: `${scope}.`,
    };
  }

  if (readmeMentions(signals.readmeText, keywords)) {
    return {
      status: "could_not_verify",
      reason:
        "The README also states this, but the README is a claim source and no matching implementation file was found — the application was not executed.",
      evidence: `${scope}.`,
    };
  }

  return {
    status: "unsupported",
    reason: "No matching route, component, file or documentation was found after inspection.",
    evidence: `${scope}.`,
  };
}

/** True when the README itself states most of the claim's key words. */
function readmeMentions(readmeText: string | null, keywords: readonly string[]): boolean {
  if (!readmeText || keywords.length === 0) return false;
  const lower = readmeText.toLowerCase();
  const hits = keywords.filter((keyword) => lower.includes(keyword)).length;
  return hits >= 2 && hits / keywords.length >= 0.4;
}

/**
 * Extract → normalize → deduplicate → verify → register.
 *
 * Every claim that comes out has been seen by verification, so the report can
 * never show an extracted claim as "unverified" or lose the list entirely.
 */
export function registerClaims(input: RegisterClaimsInput): RegisteredClaims {
  const deckClaims = claimsFromDocument(input.document);
  const readmeClaims = claimsFromReadme(input.readme);
  const extracted = deckClaims.length + readmeClaims.length;

  const merged = dedupeClaims([...deckClaims, ...readmeClaims]);
  const claims = merged.map((claim) => {
    const verdict = verifyClaim(claim, input.signals);
    return {
      ...claim,
      evidence: verdict.evidence,
      verificationStatus: verdict.status,
      verificationReason: verdict.reason,
    };
  });

  const decided = claims.filter(
    (claim) =>
      claim.verificationStatus === "supported" ||
      claim.verificationStatus === "partial" ||
      claim.verificationStatus === "unsupported",
  ).length;

  const deckLabel = input.document?.extraction.kind === "pdf" ? "PDF" : "PPT";
  const log = [
    `[${deckLabel}] extracted ${deckClaims.length} claims`,
    `[README] extracted ${readmeClaims.length} claims`,
    `[REPOSITORY] extracted 0 claims`,
    `[DEDUPLICATION] ${extracted} → ${merged.length} claims`,
    `[REGISTERED] ${claims.length} claims`,
    `[VERIFICATION] ${claims.length} claims evaluated`,
  ];
  const error = claimRegistrationError(extracted, claims.length);
  if (error) log.push(`[PIPELINE] ${error}`);

  return {
    claims,
    stats: {
      deck: deckClaims.length,
      readme: readmeClaims.length,
      repository: 0,
      extracted,
      deduped: extracted - merged.length,
      registered: claims.length,
      verified: decided,
      error,
      log,
    },
  };
}

/* --------------------------------------------------------------- scoring */

/** How much a claim's verdict counts, by verdict. Configurable, deterministic. */
export const CLAIM_VERDICT_WEIGHTS: Record<ClaimVerificationStatus, number> = {
  supported: 1,
  partial: 0.5,
  could_not_verify: 0.25,
  unverified: 0,
  unsupported: 0,
};

/** How much a claim's subject matters to the judge — security and features lead. */
export const CLAIM_CATEGORY_IMPORTANCE: Record<NormalizedClaim["category"], number> = {
  feature: 1,
  workflow: 1,
  security: 1,
  performance: 0.8,
  architecture: 0.8,
  technology: 0.7,
  solution: 0.6,
  description: 0.5,
  problem: 0.5,
  impact: 0.4,
};

/**
 * Deterministic evidence score (0–100): how much of what the team claimed the
 * inspected evidence actually backs. `null` when there are no claims to score.
 */
export function computeEvidenceScore(claims: readonly NormalizedClaim[]): number | null {
  if (claims.length === 0) return null;
  const total = claims.reduce((sum, claim) => sum + CLAIM_CATEGORY_IMPORTANCE[claim.category], 0);
  if (total === 0) return null;
  const backed = claims.reduce(
    (sum, claim) =>
      sum +
      CLAIM_VERDICT_WEIGHTS[claim.verificationStatus] * CLAIM_CATEGORY_IMPORTANCE[claim.category],
    0,
  );
  return Math.max(0, Math.min(100, Math.round((backed / total) * 100)));
}

/** Count helper re-exported for callers that only need the summary. */
export { countClaims };
