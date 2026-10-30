/**
 * Feature verification — the claim → evidence → test → verdict chain.
 *
 * Every checkable feature the team claims becomes a row, and the row records
 * what BuildLens actually did with it:
 *
 *   found    the implementation or the served page shows it
 *   tested   the deployed application was read and showed it
 *   result   supported / partial / not supported / could not verify
 *
 * The deck is never allowed to verify itself: a feature is only `found` when a
 * non-document source carries it, and `tested` only when the deployed page did.
 * A feature whose name merely appears in source code is therefore `partial`, not
 * `supported` — the code shows it was attempted, not that it works.
 */

import {
  CLAIM_STATUS_LABELS,
  type ClaimCheck,
  type EvidenceBundle,
} from "@/services/evidence/types";
import type { FeatureVerification, Severity, VerificationResult } from "./types";

/** Claims that describe something a judge can look for in a running product. */
const FEATURE_KINDS = new Set([
  "ai",
  "security",
  "integrations",
  "performance",
  "functionality",
  "features",
  "technology",
]);

/** Keys that describe the product rather than a single feature. */
const NOT_A_FEATURE = /^(we|our|the)\s+(built|made|created|developed)\b/i;

const MAX_FEATURES = 10;

function clip(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function isFeatureClaim(claim: ClaimCheck): boolean {
  if (claim.nature && claim.nature !== "checkable") return false;
  if (claim.category === "features" || claim.category === "solution") return true;
  return claim.kind ? FEATURE_KINDS.has(claim.kind) : false;
}

function severityFor(claim: ClaimCheck): Severity {
  if (claim.kind === "ai" || claim.kind === "security") return "high";
  if (claim.category === "features" || claim.kind === "functionality") return "high";
  return "medium";
}

/** Which evidence families were actually searched for this claim. */
function searchedChannels(claim: ClaimCheck, bundle: EvidenceBundle | null): string[] {
  const channels: string[] = [];
  const sources = bundle?.sources ?? [];
  const repo = sources.find((source) => source.kind === "repository");
  const site = sources.find((source) => source.kind === "website");
  const deck = sources.find((source) => source.kind === "document");

  if (deck?.readable) channels.push("Deck");
  if (repo?.readable) channels.push("Repository");
  if (site?.readable) channels.push("Deployment");
  if (channels.length === 0) return ["README / submission"];
  return channels;
}

function refsFor(claim: ClaimCheck, prefix: string): string[] {
  return (claim.evidenceRefs ?? []).filter((ref) => ref.startsWith(prefix));
}

/**
 * Build the feature table for one submission.
 *
 * Ordering is deliberate: what is missing or unproven comes first, because that
 * is what a judge has to act on; supported features follow.
 */
export function buildFeatureVerification(input: {
  claims: readonly ClaimCheck[];
  bundle: EvidenceBundle | null;
}): FeatureVerification[] {
  const { claims, bundle } = input;

  const rows: FeatureVerification[] = [];
  const seen = new Set<string>();

  for (const claim of claims) {
    if (rows.length >= MAX_FEATURES) break;
    if (!isFeatureClaim(claim)) continue;
    if (NOT_A_FEATURE.test(claim.claim)) continue;

    const feature = clip(claim.claim, 90);
    const key = feature.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const repoRefs = refsFor(claim, "GitHub:");
    const siteRefs = refsFor(claim, "Deployed page:");
    const searched = searchedChannels(claim, bundle);

    // `sources` only says which sources were consulted, so it cannot back a
    // claim on its own: the refs show that something was actually found.
    const repoBacked = repoRefs.length > 0;
    const siteBacked = siteRefs.length > 0;

    let result: VerificationResult;
    if (claim.status === "supported") result = "supported";
    else if (claim.status === "partially_supported") result = "partial";
    else if (claim.status === "not_found") result = "not_supported";
    else result = "could_not_verify";

    const found = result === "supported" || result === "partial";
    const tested = found && siteBacked;

    const severity: Severity | null =
      result === "not_supported" ? severityFor(claim) : result === "partial" ? "medium" : null;

    const note =
      result === "supported" && tested
        ? repoBacked
          ? "Found in the implementation and observed in the deployed application."
          : "Observed in the deployed application."
        : result === "supported"
          ? repoBacked
            ? "Found in the implementation. The deployed page did not show it — it may sit behind a login."
            : "Found in a readable source. The deployed page did not show it."
          : result === "partial"
            ? "Part of this claim is backed; the rest was not found in the sources that were read."
            : result === "not_supported"
              ? "No matching implementation, route or deployed feature was found after inspection."
              : claim.status === "could_not_verify"
                ? "Could not verify: no implementation or deployed page could be read for this claim."
                : CLAIM_STATUS_LABELS[claim.status];

    rows.push({
      id: `feature:${claim.id}`,
      feature,
      claim: claim.claim,
      source: claim.id.startsWith("deck.")
        ? "deck"
        : claim.id.startsWith("readme.")
          ? "readme"
          : "submission",
      claimed: true,
      found,
      tested,
      result,
      severity,
      evidence: [...repoRefs.slice(0, 2), ...siteRefs.slice(0, 2)],
      searched,
      note,
    });
  }

  const rank: Record<VerificationResult, number> = {
    not_supported: 0,
    partial: 1,
    could_not_verify: 2,
    supported: 3,
  };
  return rows.sort((a, b) => rank[a.result] - rank[b.result]);
}

/** Feature counts used by the summary strip and the scorer. */
export function featureCounts(features: readonly FeatureVerification[]): {
  total: number;
  supported: number;
  partial: number;
  missing: number;
  unverified: number;
  tested: number;
} {
  return {
    total: features.length,
    supported: features.filter((entry) => entry.result === "supported").length,
    partial: features.filter((entry) => entry.result === "partial").length,
    missing: features.filter((entry) => entry.result === "not_supported").length,
    unverified: features.filter((entry) => entry.result === "could_not_verify").length,
    tested: features.filter((entry) => entry.tested).length,
  };
}
