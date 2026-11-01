/* ------------------------------------------------------------------ score */

/** The report's score: six evidence-backed categories, no invented points. */

/**
 * The six report categories, in the order the report renders them.
 *
 * The maxima sum to 100 so a fully measured report needs no renormalisation;
 * when a category has no evidence (runtime performance is never measured by the
 * repository analysis) it is reported as unmeasured and the remaining maxima are
 * used as the denominator — the report shows exactly which points were possible.
 */
export const SCOREBOARD_CATEGORIES = [
  { key: "functionality", label: "Functionality", max: 25 },
  { key: "claimAccuracy", label: "Claim Accuracy", max: 20 },
  { key: "codeQuality", label: "Code Quality", max: 15 },
  { key: "security", label: "Security", max: 15 },
  { key: "performance", label: "Performance", max: 15 },
  { key: "documentation", label: "Documentation", max: 10 },
] as const;

export type ScoreboardCategoryKey = (typeof SCOREBOARD_CATEGORIES)[number]["key"];

export interface ScoreboardCategory {
  key: ScoreboardCategoryKey;
  label: string;
  /** Points earned, or null when the category had no evidence. */
  points: number | null;
  max: number;
  measured: boolean;
  /** One sentence explaining the number, in terms of evidence. */
  rationale: string;
  /** Extra evidence lines the report can list under the category. */
  evidence: string[];
}

export interface Scoreboard {
  /** 0–100 over the measured categories; null when nothing could be scored. */
  overall: number | null;
  points: number;
  measuredMax: number;
  categories: ScoreboardCategory[];
}

export interface ScoreboardInput {
  /** Feature/workflow claims backed by evidence, out of the claims extracted. */
  featureClaims: { supported: number; partial: number; total: number } | null;
  /** Severity-weighted share of ALL claims that the evidence backs (0–100). */
  claimEvidenceScore: number | null;
  codeQuality: number | null;
  maintainability: number | null;
  testing: number | null;
  security: number | null;
  performance: number | null;
  documentation: number | null;
}

function clampScoreOrNull(score: number | null): number | null {
  if (score === null || !Number.isFinite(score)) return null;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Weighted blend of the three repository-quality signals, over what was measured. */
function codeQualityBlend(input: ScoreboardInput): { score: number | null; parts: string[] } {
  const parts: { score: number | null; weight: number; label: string }[] = [
    { score: clampScoreOrNull(input.codeQuality), weight: 0.6, label: "code quality" },
    { score: clampScoreOrNull(input.maintainability), weight: 0.2, label: "maintainability" },
    { score: clampScoreOrNull(input.testing), weight: 0.2, label: "testing" },
  ];
  const measured = parts.filter((part) => part.score !== null);
  const weightSum = measured.reduce((sum, part) => sum + part.weight, 0);
  if (measured.length === 0 || weightSum === 0) return { score: null, parts: [] };
  const score =
    measured.reduce((sum, part) => sum + (part.score ?? 0) * part.weight, 0) / weightSum;
  return {
    score: Math.round(score),
    parts: measured.map((part) => `${part.label} ${part.score}/100`),
  };
}

/**
 * Turn measured evidence into the report's six categories.
 *
 * Pure and deterministic: the same evidence always produces the same points,
 * and a category without evidence is never given a number.
 */
export function computeScoreboard(input: ScoreboardInput): Scoreboard {
  const quality = codeQualityBlend(input);
  const claims = input.featureClaims;
  const featureShare =
    claims && claims.total > 0 ? (claims.supported + claims.partial * 0.5) / claims.total : null;

  const results: Record<
    ScoreboardCategoryKey,
    { raw: number | null; rationale: string; evidence: string[] }
  > = {
    functionality: {
      raw: featureShare === null ? null : featureShare * 100,
      rationale:
        claims === null || featureShare === null
          ? "No feature claims were extracted, so functionality could not be scored."
          : `${claims.supported} of ${claims.total} claimed features are backed by repository evidence${claims.partial > 0 ? `, ${claims.partial} only partially` : ""}.`,
      evidence:
        claims === null
          ? []
          : [
              `${claims.supported} supported · ${claims.partial} partial · ${claims.total} feature claims`,
            ],
    },
    claimAccuracy: {
      raw: clampScoreOrNull(input.claimEvidenceScore),
      rationale:
        input.claimEvidenceScore === null
          ? "No claims were registered, so claim accuracy could not be scored."
          : "Severity-weighted share of every claim (deck, README, submission) that the inspected evidence supports.",
      evidence: [],
    },
    codeQuality: {
      raw: quality.score,
      rationale:
        quality.score === null
          ? "Not enough repository evidence to score implementation quality."
          : "Repository signals: " +
            quality.parts.join(" · ") +
            " (code quality 60%, maintainability 20%, testing 20%).",
      evidence: quality.parts,
    },
    security: {
      raw: clampScoreOrNull(input.security),
      rationale:
        input.security === null
          ? "No security evidence was collected."
          : "Secret exposure, unsafe configuration and policy files found in the repository.",
      evidence: [],
    },
    performance: {
      raw: clampScoreOrNull(input.performance),
      rationale:
        input.performance === null
          ? "Not measured — the site was not executed, so no LCP/FCP/TTFB/CLS values exist."
          : "Measured on the deployed application.",
      evidence: [],
    },
    documentation: {
      raw: clampScoreOrNull(input.documentation),
      rationale:
        input.documentation === null
          ? "No documentation evidence was collected."
          : "README, setup instructions and supporting documentation found in the repository.",
      evidence: [],
    },
  };

  const categories: ScoreboardCategory[] = SCOREBOARD_CATEGORIES.map((category) => {
    const result = results[category.key];
    const measured = result.raw !== null;
    return {
      key: category.key,
      label: category.label,
      max: category.max,
      points: measured
        ? Math.round((Math.max(0, Math.min(100, result.raw ?? 0)) / 100) * category.max)
        : null,
      measured,
      rationale: result.rationale,
      evidence: result.evidence,
    };
  });

  const measuredCategories = categories.filter((category) => category.measured);
  const points = measuredCategories.reduce((sum, category) => sum + (category.points ?? 0), 0);
  const measuredMax = measuredCategories.reduce((sum, category) => sum + category.max, 0);

  return {
    overall: measuredMax > 0 ? Math.round((points / measuredMax) * 100) : null,
    points,
    measuredMax,
    categories,
  };
}

/** Human label for a score band, used in summaries and the UI. */
export function scoreBand(score: number | null): string {
  if (score === null) return "Not enough evidence";
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Strong";
  if (score >= 55) return "Needs improvement";
  return "Significant gaps";
}
