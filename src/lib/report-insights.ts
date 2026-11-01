/**
 * The report's information architecture, derived deterministically.
 *
 * The page renders this model instead of a pile of payload fragments: one
 * executive summary, one score breakdown, one claim table, then the detailed
 * sections. Everything here comes from data the analysis actually collected —
 * a metric that was not measured stays "Not measured", and nothing is invented
 * to fill a section.
 */

import { computeScoreboard, type Scoreboard } from "@/analysis/score";
import type {
  Claim,
  ClaimCounts,
  EvidenceSummaryView,
  ReportView,
  RiskFinding,
  RiskSeverity,
  ScoreboardView,
  Vital,
} from "@/lib/report-data";

/* ------------------------------------------------------------------ types */

export type VerdictTone = "verified" | "partial" | "unverified" | "unknown";

export interface ReportVerdict {
  label: string;
  tone: VerdictTone;
  description: string;
}

export type FindingTone = "critical" | "important" | "positive";

export interface ReportFinding {
  tone: FindingTone;
  title: string;
  detail: string | null;
}

export type RepositoryCheck = "verified" | "partial" | "not_found" | "unverified";
export type DeploymentCheck = "verified" | "not_tested";

export interface ClaimResult {
  claim: Claim;
  sourceLabel: string;
  repository: RepositoryCheck;
  deployment: DeploymentCheck;
  verdict: { label: string; tone: VerdictTone };
}

export type FeatureVerdict = "working" | "partial" | "not_found" | "unverified";

export interface FeatureResult {
  claim: string;
  sourceLabel: string;
  expected: string;
  tested: string;
  observed: string;
  verdict: FeatureVerdict;
  verdictLabel: string;
}

export type MetricStatus = "good" | "needs_improvement" | "poor" | "not_measured";

export interface RuntimeMetric {
  name: string;
  value: string | null;
  target: string | null;
  status: MetricStatus;
}

export interface StatusRow {
  label: string;
  value: string;
  tone: "good" | "warning" | "bad" | "neutral";
}

export interface SecurityIssue {
  title: string;
  severity: RiskSeverity;
  evidence: string | null;
  impact: string;
  fix: string | null;
}

export interface DocumentationRow {
  label: string;
  state: "present" | "partial" | "missing";
  note: string | null;
}

export interface EvidenceSourceRow {
  key: "document" | "repository" | "deployment" | "runtime";
  label: string;
  available: boolean | null;
  detail: string;
}

export interface GroupedRecommendation {
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  detail: string | null;
}

export interface ReportInsights {
  verdict: ReportVerdict;
  summary: string[];
  findings: ReportFinding[];
  scoreboard: ScoreboardView;
  claimCounts: ClaimCounts;
  claims: ClaimResult[];
  features: FeatureResult[];
  deployment: { rows: StatusRow[]; tested: { label: string; ok: boolean | null }[] };
  performance: RuntimeMetric[];
  security: { issues: SecurityIssue[]; summary: string | null };
  codeQuality: {
    score: number | null;
    summary: string | null;
    stack: string[];
    findings: string[];
    testing: string | null;
    testingNotes: string[];
    maintainability: string | null;
    maintainabilityNotes: string[];
    coveragePct: number | null;
  };
  documentation: { score: number | null; rows: DocumentationRow[]; notes: string[] };
  evidenceSources: EvidenceSourceRow[];
  recommendations: GroupedRecommendation[];
  finalVerdict: { score: number | null; strong: string[]; concerns: string[]; takeaway: string };
}

/* ---------------------------------------------------------------- helpers */

const SEVERITY_RANK: Record<RiskSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  unknown: 4,
};

const IMPORTANCE: Record<string, number> = {
  feature: 3,
  workflow: 3,
  security: 3,
  architecture: 2,
  performance: 2,
  technology: 2,
};

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function claimSourceLabel(claim: Claim): string {
  const sources = claim.sources?.length
    ? claim.sources
    : claim.source
      ? [{ source: claim.source, location: claim.sourceLocation ?? null }]
      : [];
  if (sources.length === 0) return "Submission";
  const labels = sources.map((entry) => entry.source).filter(Boolean);
  return [...new Set(labels)].join(" + ");
}

function claimVerdict(claim: Claim): { label: string; tone: VerdictTone } {
  switch (claim.status) {
    case "supported":
      return { label: "Verified", tone: "verified" };
    case "partial":
      return { label: "Partially verified", tone: "partial" };
    case "unsupported":
      return { label: "Unsupported", tone: "unverified" };
    case "could_not_verify":
      return { label: "Could not verify", tone: "unknown" };
    default:
      return claim.verified
        ? { label: "Verified", tone: "verified" }
        : { label: "Unverified", tone: "unknown" };
  }
}

function repositoryCheck(claim: Claim): RepositoryCheck {
  switch (claim.status) {
    case "supported":
      return "verified";
    case "partial":
      return "partial";
    case "unsupported":
      return "not_found";
    default:
      return claim.verified ? "verified" : "unverified";
  }
}

function isFeatureClaim(claim: Claim): boolean {
  return claim.category === "feature" || claim.category === "workflow";
}

const DOCUMENT_GROUPS: {
  key: "problem" | "solution" | "features" | "technology" | "impact";
  category: string;
  label: string;
}[] = [
  { key: "problem", category: "problem", label: "Problem" },
  { key: "solution", category: "solution", label: "Solution" },
  { key: "features", category: "feature", label: "Feature" },
  { key: "technology", category: "technology", label: "Technology" },
  { key: "impact", category: "impact", label: "Impact" },
];

/**
 * Older payloads carry deck claims under `document_analysis` without having run
 * registration. They still belong in the claim table — unverified, and labelled
 * as such — rather than disappearing from the report.
 */
function claimsFromDocument(view: ReportView): Claim[] {
  const doc = view.documentAnalysis;
  if (!doc?.claims) return [];
  const claims: Claim[] = [];
  if (doc.claims.summary) {
    claims.push({
      claim: doc.claims.summary,
      verified: false,
      evidence: null,
      source: "PPT",
      sourceLocation: doc.fileName,
      status: "unverified",
      reason: "Read from the submitted document; it was not registered for verification.",
      category: "description",
    });
  }
  for (const group of DOCUMENT_GROUPS) {
    for (const text of doc.claims[group.key]) {
      claims.push({
        claim: text,
        verified: false,
        evidence: null,
        source: "PPT",
        sourceLocation: doc.fileName,
        status: "unverified",
        reason: `Read from the submitted document (${group.label.toLowerCase()}) but not registered for verification.`,
        category: group.category,
      });
    }
  }
  return claims;
}

function countClaimsOf(claims: readonly Claim[]): ClaimCounts {
  const counts: ClaimCounts = {
    total: claims.length,
    supported: 0,
    partial: 0,
    unsupported: 0,
    could_not_verify: 0,
    unverified: 0,
  };
  for (const claim of claims) {
    const status = claim.status ?? (claim.verified ? "supported" : "unverified");
    if (status in counts && status !== "total") {
      counts[status as keyof ClaimCounts] += 1;
    } else {
      counts.unverified += 1;
    }
  }
  return counts;
}

function featureVerdict(claim: Claim): { key: FeatureVerdict; label: string } {
  switch (claim.status) {
    case "supported":
      return { key: "working", label: "Working" };
    case "partial":
      return { key: "partial", label: "Partially working" };
    case "unsupported":
      return { key: "not_found", label: "Not found" };
    default:
      return { key: "unverified", label: "Could not be verified" };
  }
}

/* --------------------------------------------------------------- verdicts */

function buildVerdict(counts: ClaimCounts): ReportVerdict {
  if (counts.total === 0) {
    return {
      label: "NOT ENOUGH EVIDENCE",
      tone: "unknown",
      description:
        "No claims were extracted from the submitted materials, so there was nothing to verify.",
    };
  }
  const decided = counts.supported + counts.partial + counts.unsupported;
  const backed = counts.supported + counts.partial * 0.5;
  if (decided === 0) {
    return {
      label: "NOT ENOUGH EVIDENCE",
      tone: "unknown",
      description:
        "Claims were extracted but none could be checked against the implementation, so this report neither confirms nor refutes them.",
    };
  }
  if (counts.unsupported === 0 && counts.partial === 0 && counts.supported > 0) {
    return {
      label: "VERIFIED",
      tone: "verified",
      description: "Every checkable claim was backed by evidence from the repository.",
    };
  }
  if (decided > 0 && backed / counts.total >= 0.6) {
    return {
      label: "PARTIALLY VERIFIED",
      tone: "partial",
      description:
        "Most claimed capabilities are backed by evidence, but some could not be confirmed.",
    };
  }
  if (decided > 0 && backed / counts.total >= 0.3) {
    return {
      label: "PARTIALLY VERIFIED",
      tone: "partial",
      description: "Some claimed capabilities are backed by evidence; a significant share is not.",
    };
  }
  return {
    label: "LARGELY UNVERIFIED",
    tone: "unverified",
    description:
      "Most claims could not be backed by the inspected evidence, so the submission overstates its work.",
  };
}

/* --------------------------------------------------------- claim support */

function scoreboardOf(view: ReportView): ScoreboardView {
  if (view.scoreboard) return view.scoreboard;

  // Legacy payloads predate the server-side scoreboard: rebuild it from the
  // same signals so old reports still get the structured breakdown.
  const featureClaims = view.claims.filter(isFeatureClaim);
  const scoreboard: Scoreboard = computeScoreboard({
    featureClaims:
      featureClaims.length === 0
        ? null
        : {
            supported: featureClaims.filter((claim) => claim.status === "supported").length,
            partial: featureClaims.filter((claim) => claim.status === "partial").length,
            total: featureClaims.length,
          },
    // An evidence score without claims would be an artifact of an older payload.
    claimEvidenceScore: view.claims.length > 0 ? view.scores.evidence : null,
    codeQuality: view.scores.codeQuality,
    maintainability: view.scores.maintainability,
    testing: view.scores.testing,
    security: view.scores.security,
    performance: view.scores.performance,
    documentation: view.scores.documentation,
  });
  return scoreboard;
}

/* ---------------------------------------------------------------- metrics */

const VITAL_RULES: { names: string[]; label: string; good: number; poor: number; unit: string }[] =
  [
    {
      names: ["lcp", "largest contentful paint"],
      label: "LCP",
      good: 2500,
      poor: 4000,
      unit: "ms",
    },
    { names: ["fcp", "first contentful paint"], label: "FCP", good: 1800, poor: 3000, unit: "ms" },
    { names: ["ttfb", "time to first byte"], label: "TTFB", good: 800, poor: 1800, unit: "ms" },
    { names: ["cls", "cumulative layout shift"], label: "CLS", good: 0.1, poor: 0.25, unit: "" },
    {
      names: ["load", "load time", "page load"],
      label: "Load time",
      good: 2500,
      poor: 5000,
      unit: "ms",
    },
  ];

function metricStatus(value: number, good: number, poor: number): MetricStatus {
  if (value <= good) return "good";
  if (value <= poor) return "needs_improvement";
  return "poor";
}

function formatMetric(value: number, unit: string): string {
  if (unit === "ms")
    return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
  return `${Math.round(value * 1000) / 1000}`;
}

function buildPerformance(view: ReportView): RuntimeMetric[] {
  const metrics: RuntimeMetric[] = [];
  const vitals: Vital[] = view.performance.vitals;

  for (const rule of VITAL_RULES) {
    const match = vitals.find((vital) => {
      const name = normalise(vital.name);
      return rule.names.some((candidate) => name === candidate || name.includes(candidate));
    });
    if (!match || match.value === null) {
      metrics.push({
        name: rule.label,
        value: null,
        target: rule.unit === "ms" ? `≤ ${formatMetric(rule.good, rule.unit)}` : `≤ ${rule.good}`,
        status: "not_measured",
      });
      continue;
    }
    metrics.push({
      name: rule.label,
      value: formatMetric(match.value, rule.unit),
      target: rule.unit === "ms" ? `≤ ${formatMetric(rule.good, rule.unit)}` : `≤ ${rule.good}`,
      status: metricStatus(match.value, rule.good, rule.poor),
    });
  }

  const weight = view.performance.pageWeightMb ?? view.website?.pageWeightMb ?? null;
  metrics.push({
    name: "Resource size",
    value: weight === null ? null : `${weight} MB`,
    target: "≤ 2 MB",
    status:
      weight === null
        ? "not_measured"
        : weight <= 2
          ? "good"
          : weight <= 5
            ? "needs_improvement"
            : "poor",
  });

  const lighthousePerformance = view.performance.lighthouse.find((entry) =>
    entry.name.toLowerCase().includes("performance"),
  );
  metrics.push({
    name: "Lighthouse performance",
    value: lighthousePerformance?.score != null ? `${lighthousePerformance.score}/100` : null,
    target: "≥ 90",
    status:
      lighthousePerformance?.score == null
        ? "not_measured"
        : lighthousePerformance.score >= 90
          ? "good"
          : lighthousePerformance.score >= 50
            ? "needs_improvement"
            : "poor",
  });

  metrics.push({
    name: "API response time",
    value: null,
    target: "≤ 500ms",
    status: "not_measured",
  });

  return metrics;
}

/* --------------------------------------------------------------- security */

function buildSecurity(view: ReportView): { issues: SecurityIssue[]; summary: string | null } {
  const seen = new Set<string>();
  const issues: SecurityIssue[] = [];
  for (const finding of [...view.security.findings, ...view.risks] as RiskFinding[]) {
    if (finding.severity === "unknown" && view.security.findings.length > 0) continue;
    const key = normalise(finding.title);
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({
      title: finding.title,
      severity: finding.severity,
      evidence: finding.detail,
      impact:
        finding.severity === "critical" || finding.severity === "high"
          ? "A judge can exploit this or see that credentials are exposed; it undermines the whole submission."
          : "Weakens the submission's security story and invites judge questions.",
      fix: finding.mitigation,
    });
  }
  issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return { issues, summary: view.security.summary };
}

/* ---------------------------------------------------------- documentation */

function buildDocumentation(
  view: ReportView,
  evidence: EvidenceSummaryView | null,
): {
  score: number | null;
  rows: DocumentationRow[];
  notes: string[];
} {
  const notes = view.documentation.notes;
  const haystack = normalise([view.documentation.summary ?? "", ...notes].join(" "));
  // With repository evidence the README path is authoritative; without it, fall
  // back to what the documentation summary says.
  const hasReadme = evidence ? evidence.readmePath !== null : /readme/.test(haystack) ? true : null;

  const matches = (pattern: RegExp) => (pattern.test(haystack) ? true : null);

  return {
    score: view.scores.documentation,
    rows: [
      {
        label: "README",
        state: hasReadme === true ? "present" : hasReadme === false ? "missing" : "partial",
        note: evidence?.readmePath ?? null,
      },
      {
        label: "Setup instructions",
        state: matches(/setup|install|getting started/) ? "present" : "partial",
        note: null,
      },
      {
        label: "Architecture documented",
        state:
          view.architecture.summary || view.architecture.layers.length > 0 ? "present" : "partial",
        note: null,
      },
      {
        label: "API documentation",
        state: matches(/api/) ? "present" : "partial",
        note: matches(/api/) ? null : "No API documentation was found in the repository listing.",
      },
      {
        label: "Deployment instructions",
        state: matches(/deploy|hosting/) ? "present" : "partial",
        note: matches(/deploy|hosting/)
          ? null
          : "Deployment steps were not found in the documentation.",
      },
    ],
    notes,
  };
}

/* --------------------------------------------------------------- evidence */

function buildEvidenceSources(
  view: ReportView,
  evidence: EvidenceSummaryView | null,
): EvidenceSourceRow[] {
  const doc = view.documentAnalysis;
  const runtimeMeasured =
    view.performance.vitals.length > 0 || (view.website?.vitals.length ?? 0) > 0;

  return [
    {
      key: "document",
      label: "Submitted PPT/PDF",
      available: doc ? (doc.status === "failed" ? false : true) : null,
      detail: doc
        ? doc.status === "failed"
          ? (doc.error ?? "The document could not be read.")
          : `${doc.fileName ?? "Submitted document"} · ${doc.totalPages ?? "?"} pages${doc.ocrApplied ? " · read via OCR" : ""}`
        : "No document was attached to this submission.",
    },
    {
      key: "repository",
      label: "GitHub repository",
      available: (evidence?.repositoryUrl ?? view.overview.repoUrl) ? true : null,
      detail: evidence
        ? `${evidence.repository ?? evidence.repositoryUrl}${evidence.filesListed !== null ? ` · ${evidence.filesListed} files listed` : ""}${evidence.inspectedAt ? ` · inspected ${evidence.inspectedAt.slice(0, 10)}` : ""}`
        : (view.overview.repoUrl ?? "No repository was inspected."),
    },
    {
      key: "deployment",
      label: "Deployed application",
      available:
        view.website?.status && view.website.status.length > 0
          ? true
          : view.overview.websiteUrl
            ? null
            : false,
      detail: view.website?.status
        ? `${view.overview.websiteUrl ?? view.website.url ?? ""} · ${view.website.status}`
        : view.overview.websiteUrl
          ? `${view.overview.websiteUrl} · submitted, but the page was not loaded by this analysis.`
          : "No deployment URL was submitted.",
    },
    {
      key: "runtime",
      label: "Runtime tests",
      available: runtimeMeasured ? true : null,
      detail: runtimeMeasured
        ? "Page metrics were recorded from the deployed site."
        : "Not performed — this analysis inspects the repository and submitted documents; it does not click through the deployed app.",
    },
  ];
}

/* -------------------------------------------------------- recommendations */

function buildRecommendations(view: ReportView): GroupedRecommendation[] {
  const out: GroupedRecommendation[] = [];
  const seen = new Set<string>();
  const push = (
    title: string,
    priority: GroupedRecommendation["priority"],
    detail: string | null,
  ) => {
    const key = normalise(title);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ title, priority, detail });
  };

  for (const finding of view.security.findings) {
    if (finding.severity === "critical" || finding.severity === "high") {
      push(finding.mitigation ?? finding.title, "critical", finding.detail);
    }
  }
  for (const risk of view.risks) {
    if (risk.severity === "critical" || risk.severity === "high") {
      push(risk.mitigation ?? risk.title, "high", risk.detail);
    }
  }
  for (const claim of view.claims) {
    if (claim.status === "unsupported" && (IMPORTANCE[claim.category ?? ""] ?? 0) >= 2) {
      push(
        `Fix or remove the unsupported claim: ${claim.claim}`,
        "high",
        claim.reason ?? "No matching implementation was found in the repository.",
      );
    }
  }
  for (const recommendation of view.recommendations) {
    const priority = normalise(recommendation.priority ?? "medium");
    push(
      recommendation.title,
      priority === "critical" || priority === "high"
        ? priority
        : priority === "low"
          ? "low"
          : "medium",
      recommendation.detail,
    );
  }
  const order: Record<GroupedRecommendation["priority"], number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  return out.sort((a, b) => order[a.priority] - order[b.priority]).slice(0, 6);
}

/* ---------------------------------------------------------------- summary */

function buildSummary(
  view: ReportView,
  claims: readonly Claim[],
  counts: ClaimCounts,
  scoreboard: ScoreboardView,
  performance: RuntimeMetric[],
  security: SecurityIssue[],
): string[] {
  const sentences: string[] = [];

  if (counts.total > 0) {
    sentences.push(
      `${counts.supported} of ${counts.total} claims are backed by repository evidence, ${counts.partial} only partially, and ${counts.unsupported + counts.could_not_verify} could not be confirmed.`,
    );
  } else if (view.executiveSummary) {
    sentences.push(view.executiveSummary);
  } else {
    sentences.push(
      "No claims were extracted from the submitted deck or README, so nothing could be verified against the implementation.",
    );
  }

  const notTested = claims.filter(
    (claim) => isFeatureClaim(claim) && claim.status === "unsupported",
  );
  if (notTested.length > 0) {
    sentences.push(
      `${notTested.length} claimed feature${notTested.length === 1 ? "" : "s"} could not be found in the repository${view.overview.websiteUrl ? ", and none of them were tested on the deployed application" : ""}.`,
    );
  }

  const measuredPerformance = performance.filter((metric) => metric.status !== "not_measured");
  if (measuredPerformance.length === 0) {
    sentences.push(
      "Performance was not measured: the deployed application was never executed, so no LCP, FCP, TTFB or CLS values exist.",
    );
  } else {
    const poor = performance.filter(
      (metric) => metric.status === "poor" || metric.status === "needs_improvement",
    );
    sentences.push(
      poor.length === 0
        ? "Every measured runtime metric is inside the recommended threshold."
        : `Measured runtime metrics include ${poor.map((metric) => `${metric.name} ${metric.value ?? "—"}`).join(", ")}, which is above the recommended threshold.`,
    );
  }

  const criticalSecurity = security.filter(
    (issue) => issue.severity === "critical" || issue.severity === "high",
  );
  sentences.push(
    criticalSecurity.length > 0
      ? `Security: ${criticalSecurity.length} high-severity issue${criticalSecurity.length === 1 ? "" : "s"} found in the repository configuration.`
      : security.length === 0
        ? "No security configuration issues were detected in the repository."
        : `Security: only ${security.length} low-severity configuration finding${security.length === 1 ? "" : "s"}.`,
  );

  if (scoreboard.measuredMax < 100) {
    sentences.push(
      `The score is computed over ${scoreboard.measuredMax} of 100 possible points; categories without evidence are excluded rather than guessed.`,
    );
  }

  return sentences.slice(0, 4);
}

function buildFindings(
  view: ReportView,
  claims: readonly Claim[],
  counts: ClaimCounts,
  security: SecurityIssue[],
  performance: RuntimeMetric[],
): ReportFinding[] {
  const critical: ReportFinding[] = [];
  const important: ReportFinding[] = [];
  const positive: ReportFinding[] = [];

  for (const issue of security.filter(
    (entry) => entry.severity === "critical" || entry.severity === "high",
  )) {
    critical.push({
      tone: "critical",
      title: issue.title,
      detail: issue.evidence ?? "Repository security finding.",
    });
  }

  const unsupported = claims
    .filter(
      (claim) => claim.status === "unsupported" && (IMPORTANCE[claim.category ?? ""] ?? 0) >= 3,
    )
    .sort((a, b) => (IMPORTANCE[b.category ?? ""] ?? 0) - (IMPORTANCE[a.category ?? ""] ?? 0));
  for (const claim of unsupported.slice(0, 2)) {
    critical.push({
      tone: "critical",
      title: `Claimed capability not found: ${claim.claim}`,
      detail: claim.reason ?? "No matching implementation was found in the inspected repository.",
    });
  }

  if (counts.partial > 0) {
    important.push({
      tone: "important",
      title: `${counts.partial} claim${counts.partial === 1 ? "" : "s"} only partially verified`,
      detail: "A related file exists, but the analysis cannot confirm the described behaviour.",
    });
  }
  const slow = performance.filter(
    (metric) => metric.status === "poor" || metric.status === "needs_improvement",
  );
  if (slow.length > 0) {
    important.push({
      tone: "important",
      title: `${slow[0]?.name ?? "Runtime metric"} is above the recommended threshold`,
      detail: slow
        .map((metric) => `${metric.name}: ${metric.value} (target ${metric.target})`)
        .join(" · "),
    });
  }
  if (view.evidence?.testFiles === 0) {
    important.push({
      tone: "important",
      title: "No automated tests in the repository",
      detail: "No test files matched the common test-file patterns in the repository listing.",
    });
  }
  if (counts.could_not_verify > 0) {
    important.push({
      tone: "important",
      title: `${counts.could_not_verify} claim${counts.could_not_verify === 1 ? "" : "s"} could not be verified`,
      detail:
        "The submitted material asserts them, but no implementation was found and the app was not executed.",
    });
  }

  if (counts.supported > 0) {
    positive.push({
      tone: "positive",
      title: `${counts.supported} claim${counts.supported === 1 ? "" : "s"} backed by repository evidence`,
      detail: "The repository contains files that support the submitted claims.",
    });
  }
  if (view.overview.techStack.length > 0) {
    positive.push({
      tone: "positive",
      title: "Technology stack detected in the repository",
      detail: view.overview.techStack.slice(0, 5).join(", "),
    });
  }
  if ((view.evidence?.testFiles ?? 0) > 0) {
    positive.push({
      tone: "positive",
      title: `${view.evidence?.testFiles} test file${view.evidence?.testFiles === 1 ? "" : "s"} detected`,
      detail: "Automated tests are present in the repository.",
    });
  }
  if (security.length === 0 && (view.scores.security ?? 0) >= 70) {
    positive.push({
      tone: "positive",
      title: "No security configuration issues found",
      detail: "No exposed secrets or unsafe configuration patterns were detected.",
    });
  }

  const picked: ReportFinding[] = [
    ...critical.slice(0, 3),
    ...important.slice(0, 2),
    ...positive.slice(0, 1),
  ];
  if (picked.filter((finding) => finding.tone !== "critical").length === 0) {
    picked.push(...important.slice(0, 1), ...positive.slice(0, 1));
  }
  return picked.slice(0, 5);
}

/* ---------------------------------------------------------------- public */

/** Build the structured report: summary, score breakdown, claims, details. */
export function buildReportInsights(view: ReportView): ReportInsights {
  const registeredClaims = view.claims.length > 0 ? view.claims : claimsFromDocument(view);
  const counts = countClaimsOf(registeredClaims);
  const scoreboard = scoreboardOf(view);
  const performance = buildPerformance(view);
  const security = buildSecurity(view);
  const evidence = view.evidence ?? null;

  const claims: ClaimResult[] = registeredClaims.map((claim) => ({
    claim,
    sourceLabel: claimSourceLabel(claim),
    repository: repositoryCheck(claim),
    deployment: "not_tested",
    verdict: claimVerdict(claim),
  }));

  const features: FeatureResult[] = registeredClaims.filter(isFeatureClaim).map((claim) => {
    const verdict = featureVerdict(claim);
    const sourceLabel = claimSourceLabel(claim);
    return {
      claim: claim.claim,
      sourceLabel,
      expected: claim.sourceLocation
        ? `Claimed in ${sourceLabel}: “${claim.claim}”`
        : `Claimed: “${claim.claim}”`,
      tested: "Repository file search against the claim's key terms, cross-checked with the README",
      observed: claim.evidence ?? claim.reason ?? "No evidence was recorded.",
      verdict: verdict.key,
      verdictLabel: verdict.label,
    };
  });

  const featureClaims = registeredClaims.filter(isFeatureClaim);
  const failedFeatures = featureClaims.filter((claim) => claim.status === "unsupported").length;
  const deploymentRows: StatusRow[] = [
    {
      label: "Availability",
      value: view.website?.status
        ? view.website.status
        : view.overview.websiteUrl
          ? "Not measured"
          : "No URL submitted",
      tone: view.website?.status ? "good" : "neutral",
    },
    {
      label: "Page loading",
      value:
        performance.find((metric) => metric.name === "LCP")?.value !== null &&
        performance.find((metric) => metric.name === "LCP")?.value !== undefined
          ? `LCP ${performance.find((metric) => metric.name === "LCP")?.value}`
          : "Not measured",
      tone: "neutral",
    },
    {
      label: "Interaction testing",
      value: `${featureClaims.length} features claimed · ${failedFeatures} not found in the repository · 0 tested on the deployed app`,
      tone: "neutral",
    },
    { label: "Console/runtime errors", value: "Not measured", tone: "neutral" },
    { label: "Broken links", value: "Not measured", tone: "neutral" },
  ];

  const strong: string[] = [];
  const concerns: string[] = [];
  for (const finding of buildFindings(
    view,
    registeredClaims,
    counts,
    security.issues,
    performance,
  )) {
    if (finding.tone === "positive") strong.push(finding.title);
    else concerns.push(finding.title);
  }
  if (counts.supported > 0 && strong.length === 0) {
    strong.push(`${counts.supported} claims verified against the repository`);
  }
  if (counts.unsupported > 0 && !concerns.some((entry) => entry.includes("not found"))) {
    concerns.push(`${counts.unsupported} claims could not be backed by evidence`);
  }

  const verdict = buildVerdict(counts);
  // The stored score wins when the payload predates the six-category breakdown;
  // the categories above are then a recomputation of the same evidence.
  const score = view.scoreboard?.overall ?? view.scores.overall ?? scoreboard.overall;

  return {
    verdict,
    summary: buildSummary(view, registeredClaims, counts, scoreboard, performance, security.issues),
    findings: buildFindings(view, registeredClaims, counts, security.issues, performance),
    scoreboard,
    claimCounts: counts,
    claims,
    features,
    deployment: { rows: deploymentRows, tested: [] },
    performance,
    security,
    codeQuality: {
      score: view.scores.codeQuality,
      summary: view.codeQuality.summary,
      stack: view.overview.techStack,
      findings: view.codeQuality.findings,
      testing: view.testing.summary,
      testingNotes: view.testing.notes,
      maintainability: view.maintainability.summary,
      maintainabilityNotes: view.maintainability.notes,
      coveragePct: view.codeQuality.coveragePct,
    },
    documentation: buildDocumentation(view, evidence),
    evidenceSources: buildEvidenceSources(view, evidence),
    recommendations: buildRecommendations(view),
    finalVerdict: {
      score,
      strong: strong.slice(0, 4),
      concerns: concerns.slice(0, 4),
      takeaway:
        counts.total === 0
          ? "The submission could not be verified: no claims were extracted, so the score reflects repository quality alone."
          : verdict.tone === "unknown"
            ? "The claims were read but not checked against the implementation, so this report neither confirms nor refutes them."
            : verdict.tone === "verified"
              ? "The submission matches what the repository shows. Its claims can be taken at face value."
              : verdict.tone === "partial"
                ? "Good implementation overall, but parts of the submission are not backed by the evidence inspected."
                : "The submission overstates its capabilities: most claims could not be verified against the code.",
    },
  };
}
