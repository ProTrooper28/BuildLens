/**
 * Deterministic evaluation scoring.
 *
 * The model may explain a project, but it never decides its number. Every
 * dimension here is computed from the evidence that was read, so the same
 * submission always receives the same score and a judge can trace each value
 * back to its inputs.
 *
 * The hierarchy follows what a hackathon judge actually has to decide:
 *
 *   1. claim verification      — does the product match the pitch?
 *   2. feature functionality   — do the claimed features exist?
 *   3. deployment              — is the thing actually running?
 *   4. security                — are there real exposures?
 *   5. technical quality       — is the code any good? (never enough on its own)
 *   6. performance / testing / documentation
 *
 * Weights are configurable (pass your own record); a dimension that could not be
 * measured is dropped and the remaining weights are renormalised — it is never
 * replaced by a neutral 50, which would reward missing evidence.
 *
 * Hard caps encode the rules a judge should never have to re-derive:
 *   · a major document mismatch cannot score above 45
 *   · an exposed credential cannot score above 60
 *   · a failing claim score cannot score above 65
 *   · absent core features cannot score above 70
 */

import type { ClaimCheck, EvidenceBundle, EvidenceObservation } from "@/services/evidence/types";
import type { DeploymentInspection } from "@/services/inspection/types";
import {
  DIMENSION_IDS,
  DIMENSION_LABELS,
  type DimensionId,
  type DimensionScore,
  type DocumentMismatch,
  type FeatureVerification,
  type ScoreBreakdown,
  type ScoreCap,
  type SecurityAssessment,
} from "./types";

export const DEFAULT_SCORE_WEIGHTS: Record<DimensionId, number> = {
  claimVerification: 30,
  featureFunctionality: 18,
  deployment: 12,
  security: 12,
  technicalQuality: 10,
  performance: 6,
  testing: 6,
  documentation: 6,
};

export interface ScoreInput {
  claims: readonly ClaimCheck[];
  features: readonly FeatureVerification[];
  deployment: DeploymentInspection;
  security: SecurityAssessment;
  mismatch: DocumentMismatch;
  bundle: EvidenceBundle | null;
}

function round(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function observation(bundle: EvidenceBundle | null, id: string): EvidenceObservation | null {
  for (const source of bundle?.sources ?? []) {
    const match = (source.observations ?? []).find((entry) => entry.id === id);
    if (match) return match;
  }
  return null;
}

function numberIn(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  return match?.[1] ? Number(match[1]) : null;
}

/* --------------------------------------------------------------- dimensions */

function claimDimension(claims: readonly ClaimCheck[]): DimensionScore {
  const checkable = claims.filter((claim) => (claim.nature ?? "checkable") === "checkable");
  const decided = checkable.filter((claim) => claim.status !== "could_not_verify");

  if (checkable.length === 0) {
    return {
      id: "claimVerification",
      label: DIMENSION_LABELS.claimVerification,
      score: null,
      weight: DEFAULT_SCORE_WEIGHTS.claimVerification,
      basis: "not_measured",
      reason: "No checkable claims were submitted, so claims could not be scored.",
    };
  }
  if (decided.length === 0) {
    return {
      id: "claimVerification",
      label: DIMENSION_LABELS.claimVerification,
      score: null,
      weight: DEFAULT_SCORE_WEIGHTS.claimVerification,
      basis: "not_measured",
      reason: "No claim could be checked against a readable source.",
    };
  }

  const supported = decided.filter((claim) => claim.status === "supported").length;
  const partial = decided.filter((claim) => claim.status === "partially_supported").length;
  const missing = decided.filter((claim) => claim.status === "not_found").length;

  const base = ((supported + partial * 0.5) / decided.length) * 100;

  // A missing claim the product should obviously have is worse than a missing
  // nice-to-have: false AI/security/feature claims are the ones that mislead.
  const criticalFalse = decided.filter(
    (claim) =>
      claim.status === "not_found" &&
      (claim.kind === "ai" ||
        claim.kind === "security" ||
        claim.kind === "features" ||
        claim.kind === "functionality"),
  ).length;
  const score = base * (1 - 0.15 * Math.min(3, criticalFalse));

  return {
    id: "claimVerification",
    label: DIMENSION_LABELS.claimVerification,
    score: round(score),
    weight: DEFAULT_SCORE_WEIGHTS.claimVerification,
    basis: "derived",
    reason: `${supported} supported, ${partial} partial, ${missing} not found of ${decided.length} checked claims${criticalFalse > 0 ? ` · ${criticalFalse} core claim${criticalFalse === 1 ? "" : "s"} missing` : ""}.`,
  };
}

function featureDimension(features: readonly FeatureVerification[]): DimensionScore {
  const decided = features.filter((feature) => feature.result !== "could_not_verify");
  if (features.length === 0) {
    return {
      id: "featureFunctionality",
      label: DIMENSION_LABELS.featureFunctionality,
      score: null,
      weight: DEFAULT_SCORE_WEIGHTS.featureFunctionality,
      basis: "not_measured",
      reason: "No feature-level claims were extracted, so features could not be tested.",
    };
  }
  if (decided.length === 0) {
    return {
      id: "featureFunctionality",
      label: DIMENSION_LABELS.featureFunctionality,
      score: null,
      weight: DEFAULT_SCORE_WEIGHTS.featureFunctionality,
      basis: "not_measured",
      reason: "No feature could be checked against a readable source.",
    };
  }
  const supported = decided.filter((feature) => feature.result === "supported").length;
  const partial = decided.filter((feature) => feature.result === "partial").length;
  const score = ((supported + partial * 0.5) / decided.length) * 100;

  return {
    id: "featureFunctionality",
    label: DIMENSION_LABELS.featureFunctionality,
    score: round(score),
    weight: DEFAULT_SCORE_WEIGHTS.featureFunctionality,
    basis: "derived",
    reason: `${supported} of ${decided.length} checked features supported, ${partial} partial.`,
  };
}

function deploymentDimension(deployment: DeploymentInspection): DimensionScore {
  if (!deployment.applicable) {
    return {
      id: "deployment",
      label: DIMENSION_LABELS.deployment,
      score: null,
      weight: DEFAULT_SCORE_WEIGHTS.deployment,
      basis: "not_measured",
      reason: "This project type does not require a deployed website.",
    };
  }
  const scored: Record<string, number> = {
    good: 100,
    info: 90,
    supported: 100,
    not_detected: 85,
    partially_supported: 55,
    warning: 55,
    not_found: 30,
    critical: 20,
    could_not_verify: Number.NaN,
  };
  const values = deployment.rows
    .map((row) => scored[row.status] ?? Number.NaN)
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) {
    return {
      id: "deployment",
      label: DIMENSION_LABELS.deployment,
      score: null,
      weight: DEFAULT_SCORE_WEIGHTS.deployment,
      basis: "not_measured",
      reason: deployment.url
        ? "The deployed URL was submitted but nothing measurable could be read from it."
        : "No deployed URL was submitted, so the live application was not measured.",
    };
  }
  const score = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    id: "deployment",
    label: DIMENSION_LABELS.deployment,
    score: round(score),
    weight: DEFAULT_SCORE_WEIGHTS.deployment,
    basis: "measured",
    reason: `${values.length} deployment check${values.length === 1 ? "" : "s"} were measured against the live URL.`,
  };
}

function securityDimension(security: SecurityAssessment): DimensionScore {
  return {
    id: "security",
    label: DIMENSION_LABELS.security,
    score: security.score,
    weight: DEFAULT_SCORE_WEIGHTS.security,
    basis: security.score === null ? "not_measured" : "derived",
    reason:
      security.score === null
        ? "No security source could be read."
        : `${security.counts.critical} critical · ${security.counts.high} high · ${security.counts.medium} medium · ${security.counts.low} low findings.`,
  };
}

function technicalQualityDimension(bundle: EvidenceBundle | null): DimensionScore {
  const quality = observation(bundle, "repo.quality");
  const maintainability = observation(bundle, "repo.maintainability");
  const values: number[] = [];
  for (const entry of [quality, maintainability]) {
    if (!entry) continue;
    const value = numberIn(entry.result, /(\d{1,3})\/100/);
    if (value !== null) values.push(value);
  }
  if (values.length === 0) {
    return {
      id: "technicalQuality",
      label: DIMENSION_LABELS.technicalQuality,
      score: null,
      weight: DEFAULT_SCORE_WEIGHTS.technicalQuality,
      basis: "not_measured",
      reason: "No structural code-quality signal could be computed.",
    };
  }
  return {
    id: "technicalQuality",
    label: DIMENSION_LABELS.technicalQuality,
    score: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    weight: DEFAULT_SCORE_WEIGHTS.technicalQuality,
    basis: "measured",
    reason:
      "Structural signals from the repository listing (organisation, file sizes, duplication). Not the same as product quality.",
  };
}

function performanceDimension(bundle: EvidenceBundle | null): DimensionScore {
  const response = observation(bundle, "site.performance.response");
  if (!response) {
    return {
      id: "performance",
      label: DIMENSION_LABELS.performance,
      score: null,
      weight: DEFAULT_SCORE_WEIGHTS.performance,
      basis: "not_measured",
      reason: "No response time was measured, so no performance score is reported.",
    };
  }
  const ms = numberIn(response.evidence.join(" "), /in (\d+)ms/);
  if (ms === null) {
    return {
      id: "performance",
      label: DIMENSION_LABELS.performance,
      score: null,
      weight: DEFAULT_SCORE_WEIGHTS.performance,
      basis: "not_measured",
      reason: "A response was measured but no time was recorded.",
    };
  }

  let score = ms <= 800 ? 100 : ms <= 2000 ? 85 : ms <= 4000 ? 65 : 45;
  const failed = observation(bundle, "site.performance.failed_resources");
  const large = observation(bundle, "site.performance.large_assets");
  const failedCount = failed?.status === "warning" ? failed.evidence.length : 0;
  const largeCount = large?.status === "warning" ? large.evidence.length : 0;
  score -= Math.min(30, failedCount * 10);
  score -= Math.min(15, largeCount * 5);

  return {
    id: "performance",
    label: DIMENSION_LABELS.performance,
    score: round(score),
    weight: DEFAULT_SCORE_WEIGHTS.performance,
    basis: "measured",
    reason: `First response ${ms} ms${failedCount > 0 ? `, ${failedCount} failed resources` : ""}${largeCount > 0 ? `, ${largeCount} oversized assets` : ""}. LCP and console errors were not measurable.`,
  };
}

function testingDimension(bundle: EvidenceBundle | null): DimensionScore {
  const tests = observation(bundle, "repo.code.tests");
  if (!tests) {
    return {
      id: "testing",
      label: DIMENSION_LABELS.testing,
      score: null,
      weight: DEFAULT_SCORE_WEIGHTS.testing,
      basis: "not_measured",
      reason: "No repository was read, so tests could not be checked.",
    };
  }
  const score = tests.status === "good" ? 100 : tests.status === "warning" ? 45 : 30;
  return {
    id: "testing",
    label: DIMENSION_LABELS.testing,
    score,
    weight: DEFAULT_SCORE_WEIGHTS.testing,
    basis: "derived",
    reason:
      tests.status === "good"
        ? "Test files were found in the repository."
        : "No test files were found in the repository that was read.",
  };
}

function documentationDimension(bundle: EvidenceBundle | null): DimensionScore {
  const docs = observation(bundle, "repo.code.docs");
  if (!docs) {
    return {
      id: "documentation",
      label: DIMENSION_LABELS.documentation,
      score: null,
      weight: DEFAULT_SCORE_WEIGHTS.documentation,
      basis: "not_measured",
      reason: "No repository was read, so documentation could not be checked.",
    };
  }
  return {
    id: "documentation",
    label: DIMENSION_LABELS.documentation,
    score: docs.status === "good" ? 85 : docs.status === "warning" ? 50 : 30,
    weight: DEFAULT_SCORE_WEIGHTS.documentation,
    basis: "derived",
    reason:
      docs.status === "good"
        ? "A README documents the project."
        : "Documentation is thin or missing.",
  };
}

/* ----------------------------------------------------------------- overall */

export function scoreEvaluation(
  input: ScoreInput,
  weights = DEFAULT_SCORE_WEIGHTS,
): ScoreBreakdown {
  const dimensions: DimensionScore[] = [
    claimDimension(input.claims),
    featureDimension(input.features),
    deploymentDimension(input.deployment),
    securityDimension(input.security),
    technicalQualityDimension(input.bundle),
    performanceDimension(input.bundle),
    testingDimension(input.bundle),
    documentationDimension(input.bundle),
  ].map((dimension) => ({ ...dimension, weight: weights[dimension.id] ?? dimension.weight }));

  const measured = dimensions.filter((dimension) => dimension.score !== null);
  const weightTotal = measured.reduce((sum, dimension) => sum + dimension.weight, 0);

  let overall: number | null = null;
  if (measured.length > 0 && weightTotal > 0) {
    const weighted = measured.reduce(
      (sum, dimension) => sum + (dimension.score as number) * dimension.weight,
      0,
    );
    overall = round(weighted / weightTotal);
  }

  const caps: ScoreCap[] = [];
  if (input.mismatch.level === "major") {
    caps.push({ reason: "The submitted document does not describe this project.", cap: 45 });
  }
  if (input.security.counts.critical > 0) {
    caps.push({ reason: "A credential appears to be exposed in the sources.", cap: 60 });
  }
  const claimScore = dimensions.find((dimension) => dimension.id === "claimVerification")?.score;
  if (claimScore !== null && claimScore !== undefined && claimScore < 40) {
    caps.push({ reason: "Most checked claims are not supported by the evidence.", cap: 65 });
  }
  const featureScore = dimensions.find(
    (dimension) => dimension.id === "featureFunctionality",
  )?.score;
  if (featureScore !== null && featureScore !== undefined && featureScore < 30) {
    caps.push({ reason: "The claimed core features were not found in the product.", cap: 70 });
  }

  if (overall !== null) {
    for (const cap of caps) overall = Math.min(overall, cap.cap);
  }

  return {
    overall,
    dimensions,
    caps,
    weights: { ...weights, ...Object.fromEntries(DIMENSION_IDS.map((id) => [id, weights[id]])) },
  };
}

/** Short band label for the overall score — never a claim about quality. */
export function scoreBand(overall: number | null): string {
  if (overall === null) return "Not scored";
  if (overall >= 80) return "Strong";
  if (overall >= 65) return "Promising";
  if (overall >= 45) return "Mixed";
  if (overall >= 25) return "Weak";
  return "Not demonstrated";
}
