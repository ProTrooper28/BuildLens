/**
 * Normalisation for `reports.report_data`.
 *
 * The column is `jsonb` and has been written by more than one producer: the
 * original seeded/demo payloads (overview / repositoryDetail / websiteDetail …)
 * and newer structured analyst payloads (executive_summary / architecture /
 * code_quality / risks …). This module turns either shape — or a partial,
 * malformed payload — into one view model the report page can render without
 * crashing or inventing values.
 *
 * Rules:
 *  - never fabricate a score or a section: missing values stay `null` / empty
 *  - unknown shapes are ignored rather than thrown
 *  - the caller can tell which sections actually carried data (`present`)
 */

import type { Json } from "@/types/database";

export type ReportStatusKind = "completed" | "in_progress" | "failed" | "unknown";

/* ------------------------------------------------------------------ helpers */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return asString(item);
      if (isRecord(item)) {
        return asString(item["title"]) ?? asString(item["label"]) ?? asString(item["text"]);
      }
      return null;
    })
    .filter((item): item is string => Boolean(item));
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => item as Record<string, unknown>);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const str = asString(value);
    if (str) return str;
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const num = asNumber(value);
    if (num !== null) return num;
  }
  return null;
}

function clampScore(value: number | null): number | null {
  if (value === null) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/* -------------------------------------------------------------------- types */

export interface MetricEntry {
  label: string;
  score: number | null;
  note: string | null;
}

export interface StackEntry {
  name: string;
  detail: string | null;
}

export interface LayerEntry {
  name: string;
  detail: string | null;
}

export type RiskSeverity = "critical" | "high" | "medium" | "low" | "unknown";

export interface RiskFinding {
  title: string;
  detail: string | null;
  severity: RiskSeverity;
  mitigation: string | null;
}

export interface Recommendation {
  title: string;
  detail: string | null;
  priority: string | null;
}

export interface Vital {
  name: string;
  value: number | null;
  unit: string;
  threshold: number | null;
  good: boolean | null;
}

export interface Claim {
  claim: string;
  verified: boolean;
  evidence: string | null;
  /** Where the claim came from: `PPT`, `PDF`, `README`, `SUBMISSION`. */
  source?: string | null;
  /** `Slide 6`, `README.md — Features`, … */
  sourceLocation?: string | null;
  /** Deterministic verdict from the registered claim pipeline. */
  status?: string | null;
  /** Why that verdict was assigned, in plain language. */
  reason?: string | null;
  category?: string | null;
  /** Where the claim appeared — several sources are merged into one row. */
  sources?: { source: string; location: string | null }[] | undefined;
}

export interface ClaimCounts {
  total: number;
  supported: number;
  partial: number;
  unsupported: number;
  could_not_verify: number;
  unverified: number;
}

/** Extraction → dedup → registration bookkeeping for one report. */
export interface ClaimPipeline {
  deck: number;
  readme: number;
  repository: number;
  extracted: number;
  deduped: number;
  registered: number;
  verified: number;
  /** Set when claims were extracted but none reached registration. */
  error: string | null;
}

export interface RepositoryDetail {
  url: string | null;
  stars: number | null;
  forks: number | null;
  commits: number | null;
  contributors: number | null;
  openIssues: number | null;
  languages: { name: string; pct: number }[];
  commitActivity: { day: string; commits: number }[];
  notes: string[];
  testCoveragePct: number | null;
  license: string | null;
  hasTests: boolean | null;
  hasCI: boolean | null;
}

export interface WebsiteDetail {
  url: string | null;
  status: string | null;
  lighthouse: { name: string; score: number | null }[];
  vitals: Vital[];
  pageWeightMb: number | null;
}

export interface InnovationDetail {
  score: number | null;
  summary: string | null;
  markers: { label: string; detail: string | null }[];
  comparable: string | null;
}

export interface DocumentClaimsView {
  summary: string | null;
  problem: string[];
  solution: string[];
  features: string[];
  technology: string[];
  impact: string[];
  method: string | null;
}

/** `report_data.evidence` — what the analysis actually inspected. */
export interface EvidenceSummaryView {
  provider: string | null;
  repository: string | null;
  repositoryUrl: string | null;
  defaultBranch: string | null;
  license: string | null;
  filesListed: number | null;
  inspectedAt: string | null;
  readmePath: string | null;
  testFiles: number | null;
  packageManager: string | null;
  configFiles: string[];
}

/** `report_data.document_analysis` — claims extracted from the submitted deck. */
export interface DocumentAnalysisView {
  status: string | null;
  fileName: string | null;
  fileType: string | null;
  totalPages: number | null;
  charsExtracted: number | null;
  method: string | null;
  ocrApplied: boolean | null;
  error: string | null;
  warnings: string[];
  /** `text` is a short preview used to cite the page a claim came from. */
  pages: { page: number; chars: number; source: string; text: string | null }[];
  claims: DocumentClaimsView | null;
  disclaimer: string | null;
  extractedAt: string | null;
}

export interface ReportScoreSet {
  overall: number | null;
  evidence: number | null;
  codeQuality: number | null;
  security: number | null;
  performance: number | null;
  maintainability: number | null;
  testing: number | null;
  documentation: number | null;
  innovation: number | null;
}

/** One row of the report's score breakdown (six fixed categories). */
export interface ScoreboardCategoryView {
  key: string;
  label: string;
  /** Points earned, or null when the category had no evidence. */
  points: number | null;
  max: number;
  measured: boolean;
  rationale: string;
  evidence: string[];
}

export interface ScoreboardView {
  overall: number | null;
  points: number;
  measuredMax: number;
  categories: ScoreboardCategoryView[];
}

export interface ReportAnalysisStage {
  key: string;
  label: string;
  state: string;
  detail: string | null;
}

export interface ReportAnalysisMeta {
  state: string | null;
  stages: ReportAnalysisStage[];
  error: { code: string; message: string; hint: string | null } | null;
  limitations: string[];
  startedAt: string | null;
  completedAt: string | null;
}

export type ReportSectionKey =
  | "executiveSummary"
  | "overview"
  | "architecture"
  | "codeQuality"
  | "security"
  | "performance"
  | "maintainability"
  | "documentation"
  | "testing"
  | "risks"
  | "recommendations"
  | "documentAnalysis"
  | "overallScore";

export interface ReportView {
  executiveSummary: string | null;
  overview: {
    summary: string | null;
    highlights: string[];
    techStack: string[];
    repoUrl: string | null;
    websiteUrl: string | null;
  };
  architecture: {
    summary: string | null;
    stack: StackEntry[];
    layers: LayerEntry[];
    decisions: string[];
  };
  codeQuality: {
    summary: string | null;
    findings: string[];
    coveragePct: number | null;
    notes: string[];
  };
  security: {
    summary: string | null;
    findings: RiskFinding[];
  };
  performance: {
    summary: string | null;
    lighthouse: { name: string; score: number | null }[];
    vitals: Vital[];
    pageWeightMb: number | null;
  };
  maintainability: {
    summary: string | null;
    notes: string[];
  };
  documentation: {
    summary: string | null;
    notes: string[];
  };
  testing: {
    summary: string | null;
    notes: string[];
  };
  risks: RiskFinding[];
  recommendations: Recommendation[];
  metrics: MetricEntry[];
  scores: ReportScoreSet;
  repository: RepositoryDetail | null;
  website: WebsiteDetail | null;
  claims: Claim[];
  claimCounts: ClaimCounts;
  claimPipeline: ClaimPipeline | null;
  documentAnalysis: DocumentAnalysisView | null;
  evidence: EvidenceSummaryView | null;
  innovation: InnovationDetail | null;
  timeline: { time: string; event: string }[];
  interviewQuestions: string[];
  judgeQuestions: string[];
  /** The six-category score breakdown the report leads with (null on legacy payloads). */
  scoreboard: ScoreboardView | null;
  analysis: ReportAnalysisMeta | null;
  /** Which required sections actually carried data in the payload. */
  present: Record<ReportSectionKey, boolean>;
  /** True when the payload had at least one recognised field. */
  hasPayloadData: boolean;
}

/* ------------------------------------------------------------- normalisation */

const SEVERITIES: RiskSeverity[] = ["critical", "high", "medium", "low"];

function normalizeSeverity(value: unknown): RiskSeverity {
  const raw = asString(value)?.toLowerCase();
  if (raw && (SEVERITIES as string[]).includes(raw)) return raw as RiskSeverity;
  if (raw === "moderate") return "medium";
  if (raw === "severe" || raw === "blocker") return "high";
  if (raw === "info" || raw === "informational" || raw === "minor") return "low";
  return "unknown";
}

function normalizeRisks(value: unknown): RiskFinding[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): RiskFinding | null => {
      if (typeof item === "string") {
        const title = asString(item);
        return title ? { title, detail: null, severity: "unknown", mitigation: null } : null;
      }
      if (!isRecord(item)) return null;
      const title = firstString(item["title"], item["name"], item["finding"], item["claim"]);
      if (!title) return null;
      return {
        title,
        detail: firstString(item["detail"], item["description"], item["evidence"], item["summary"]),
        severity: normalizeSeverity(item["severity"] ?? item["level"] ?? item["risk"]),
        mitigation: firstString(item["mitigation"], item["fix"], item["recommendation"]),
      };
    })
    .filter((item): item is RiskFinding => item !== null);
}

function normalizeRecommendations(value: unknown): Recommendation[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): Recommendation | null => {
      if (typeof item === "string") {
        const title = asString(item);
        return title ? { title, detail: null, priority: null } : null;
      }
      if (!isRecord(item)) return null;
      const title = firstString(item["title"], item["action"], item["label"], item["text"]);
      if (!title) return null;
      return {
        title,
        detail: firstString(item["detail"], item["description"], item["rationale"]),
        priority: firstString(item["priority"], item["severity"], item["effort"]),
      };
    })
    .filter((item): item is Recommendation => item !== null);
}

function normalizeStack(value: unknown): StackEntry[] {
  if (Array.isArray(value)) {
    return value
      .map((item): StackEntry | null => {
        if (typeof item === "string") {
          const name = asString(item);
          return name ? { name, detail: null } : null;
        }
        if (!isRecord(item)) return null;
        const name = firstString(item["name"], item["label"], item["technology"], item["tech"]);
        if (!name) return null;
        return {
          name,
          detail: firstString(item["detail"], item["description"], item["version"], item["role"]),
        };
      })
      .filter((item): item is StackEntry => item !== null);
  }
  const record = asRecord(value);
  return Object.entries(record)
    .map(([name, detail]): StackEntry | null => {
      const text = asString(detail);
      return name ? { name, detail: text } : null;
    })
    .filter((item): item is StackEntry => item !== null);
}

function normalizeLayers(value: unknown): LayerEntry[] {
  return asRecordArray(value)
    .map((item): LayerEntry | null => {
      const name = firstString(item["name"], item["layer"], item["title"]);
      if (!name) return null;
      return {
        name,
        detail: firstString(item["detail"], item["description"], item["responsibility"]),
      };
    })
    .filter((item): item is LayerEntry => item !== null);
}

function normalizeMetrics(value: unknown): MetricEntry[] {
  return asRecordArray(value)
    .map((item): MetricEntry | null => {
      const label = firstString(item["label"], item["name"], item["metric"]);
      if (!label) return null;
      return {
        label,
        score: clampScore(firstNumber(item["score"], item["value"])),
        note: firstString(item["note"], item["detail"], item["description"]),
      };
    })
    .filter((item): item is MetricEntry => item !== null);
}

function normalizeLighthouse(value: unknown): { name: string; score: number | null }[] {
  const record = asRecord(value);
  return Object.entries(record).map(([name, score]) => ({
    name: name.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
    score: clampScore(asNumber(score)),
  }));
}

function normalizeVitals(value: unknown): Vital[] {
  return asRecordArray(value)
    .map((item): Vital | null => {
      const name = firstString(item["name"], item["metric"]);
      if (!name) return null;
      return {
        name,
        value: asNumber(item["value"]),
        unit: asString(item["unit"]) ?? "",
        threshold: asNumber(item["threshold"]),
        good: asBoolean(item["good"]),
      };
    })
    .filter((item): item is Vital => item !== null);
}

function normalizeClaims(value: unknown): Claim[] {
  return asRecordArray(value)
    .map((item): Claim | null => {
      const claim = firstString(item["claim"], item["title"], item["feature"]);
      if (!claim) return null;
      const status = firstString(item["status"], item["verification_status"]);
      const sources = asRecordArray(item["sources"])
        .map((entry) => ({
          source: firstString(entry["source"]) ?? "",
          location: firstString(entry["location"]),
        }))
        .filter((entry) => entry.source !== "");
      return {
        claim,
        // A claim counts as verified only on an explicit supported verdict —
        // never because the claim itself appeared somewhere.
        verified: status ? status === "supported" : (asBoolean(item["verified"]) ?? false),
        evidence: firstString(item["evidence"], item["detail"], item["proof"]),
        source: firstString(item["source"]),
        sourceLocation: firstString(item["source_location"], item["sourceLocation"]),
        status: status ?? null,
        reason: firstString(item["reason"], item["verification_reason"]),
        category: firstString(item["category"]),
        sources: sources.length > 0 ? sources : undefined,
      };
    })
    .filter((item): item is Claim => item !== null);
}

function normalizeClaimCounts(value: unknown, claims: readonly Claim[]): ClaimCounts {
  const record = asRecord(value);
  const count = (key: string, fallback: number) =>
    typeof record[key] === "number" && Number.isFinite(record[key])
      ? (record[key] as number)
      : fallback;
  const derived: ClaimCounts = {
    total: claims.length,
    supported: claims.filter((claim) => claim.verified).length,
    partial: 0,
    unsupported: 0,
    could_not_verify: 0,
    unverified: 0,
  };
  for (const claim of claims) {
    if (claim.status === "partial") derived.partial += 1;
    else if (claim.status === "unsupported") derived.unsupported += 1;
    else if (claim.status === "could_not_verify") derived.could_not_verify += 1;
    else if (claim.status === "unverified" || claim.status === null) derived.unverified += 1;
  }
  return {
    total: count("total", derived.total),
    supported: count("supported", derived.supported),
    partial: count("partial", derived.partial),
    unsupported: count("unsupported", derived.unsupported),
    could_not_verify: count("could_not_verify", derived.could_not_verify),
    unverified: count("unverified", derived.unverified),
  };
}

function normalizeClaimPipeline(value: unknown): ClaimPipeline | null {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return null;
  const num = (key: string) =>
    typeof record[key] === "number" && Number.isFinite(record[key]) ? (record[key] as number) : 0;
  return {
    deck: num("deck"),
    readme: num("readme"),
    repository: num("repository"),
    extracted: num("extracted"),
    deduped: num("deduped"),
    registered: num("registered"),
    verified: num("verified"),
    error: firstString(record["error"]),
  };
}

function normalizeDocumentClaims(value: unknown): DocumentClaimsView | null {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return null;
  const view: DocumentClaimsView = {
    summary: asString(record["summary"]),
    problem: asStringArray(record["problem"]),
    solution: asStringArray(record["solution"]),
    features: asStringArray(record["features"]),
    technology: asStringArray(record["technology"]),
    impact: asStringArray(record["impact"]),
    method: asString(record["method"]),
  };
  const empty =
    view.summary === null &&
    view.problem.length === 0 &&
    view.solution.length === 0 &&
    view.features.length === 0 &&
    view.technology.length === 0 &&
    view.impact.length === 0;
  return empty ? null : view;
}

function normalizeDocumentAnalysis(value: unknown): DocumentAnalysisView | null {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return null;
  return {
    status: asString(record["status"]),
    fileName: firstString(record["file_name"], record["fileName"]),
    fileType: firstString(record["file_type"], record["fileType"]),
    totalPages: firstNumber(record["total_pages"], record["totalPages"]),
    charsExtracted: firstNumber(record["chars_extracted"], record["charsExtracted"]),
    method: asString(record["method"]),
    ocrApplied: asBoolean(record["ocr_applied"] ?? record["ocrApplied"]),
    error: asString(record["error"]),
    warnings: asStringArray(record["warnings"]),
    pages: asRecordArray(record["pages"]).map((page) => ({
      page: asNumber(page["page"]) ?? 0,
      chars: asNumber(page["chars"]) ?? 0,
      source: asString(page["source"]) ?? "none",
      text: asString(page["text"]),
    })),
    claims: normalizeDocumentClaims(record["claims"]),
    disclaimer: asString(record["disclaimer"]),
    extractedAt: firstString(record["extracted_at"], record["extractedAt"]),
  };
}

function normalizeTimeline(value: unknown): { time: string; event: string }[] {
  return asRecordArray(value)
    .map((item) => {
      const time = firstString(item["time"], item["date"], item["at"]);
      const event = firstString(item["event"], item["title"], item["detail"]);
      return time && event ? { time, event } : null;
    })
    .filter((item): item is { time: string; event: string } => item !== null);
}

function normalizeEvidenceSummary(value: unknown): EvidenceSummaryView | null {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return null;
  if (asString(record["repository"]) === null && asString(record["repository_url"]) === null) {
    return null;
  }
  return {
    provider: firstString(record["provider"]),
    repository: firstString(record["repository"]),
    repositoryUrl: firstString(record["repository_url"], record["repositoryUrl"]),
    defaultBranch: firstString(record["default_branch"], record["defaultBranch"]),
    license: firstString(record["license"]),
    filesListed: asNumber(record["files_listed"] ?? record["filesListed"]),
    inspectedAt: firstString(record["inspected_at"], record["inspectedAt"]),
    readmePath: firstString(record["readme"]),
    testFiles: asNumber(record["test_files"] ?? record["testFiles"]),
    packageManager: firstString(record["package_manager"], record["packageManager"]),
    configFiles: asStringArray(record["config_files"] ?? record["configFiles"]),
  };
}

function normalizeRepository(value: unknown): RepositoryDetail | null {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return null;

  const languages = asRecordArray(record["languages"])
    .map((item) => {
      const name = firstString(item["name"], item["language"]);
      const pct = firstNumber(item["pct"], item["percent"], item["percentage"]);
      return name && pct !== null ? { name, pct } : null;
    })
    .filter((item): item is { name: string; pct: number } => item !== null);
  const languageStrings = asStringArray(record["languages"]);

  const commitActivity = asRecordArray(record["commitActivity"] ?? record["commitsByDay"])
    .map((item) => {
      const day = firstString(item["day"], item["date"]);
      const commits = firstNumber(item["commits"], item["count"]);
      return day && commits !== null ? { day, commits } : null;
    })
    .filter((item): item is { day: string; commits: number } => item !== null);

  return {
    url: firstString(record["url"], record["repoUrl"], record["repositoryUrl"]),
    stars: asNumber(record["stars"]),
    forks: asNumber(record["forks"]),
    commits: asNumber(record["commits"]),
    contributors: asNumber(record["contributors"]),
    openIssues: asNumber(record["openIssues"] ?? record["open_issues"]),
    languages:
      languages.length > 0
        ? languages
        : languageStrings.map((name) => ({ name, pct: 0 })).filter((l) => l.pct >= 0),
    commitActivity,
    notes: asStringArray(record["codeQualityNotes"] ?? record["notes"] ?? record["findings"]),
    testCoveragePct: asNumber(
      record["testCoveragePct"] ?? record["coveragePct"] ?? record["coverage"],
    ),
    license: asString(record["license"]),
    hasTests: asBoolean(record["hasTests"]),
    hasCI: asBoolean(record["hasCI"]),
  };
}

function normalizeWebsite(value: unknown): WebsiteDetail | null {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return null;
  return {
    url: firstString(record["url"], record["websiteUrl"]),
    status: firstString(record["status"]),
    lighthouse: normalizeLighthouse(record["lighthouse"]),
    vitals: normalizeVitals(record["vitals"]),
    pageWeightMb: asNumber(record["pageWeightMb"] ?? record["page_weight_mb"]),
  };
}

function normalizeInnovation(value: unknown): InnovationDetail | null {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return null;
  return {
    score: clampScore(asNumber(record["score"])),
    summary: firstString(record["summary"], record["detail"]),
    markers: asRecordArray(record["markers"])
      .map((item) => {
        const label = firstString(item["label"], item["name"], item["title"]);
        return label ? { label, detail: firstString(item["detail"], item["description"]) } : null;
      })
      .filter((item): item is { label: string; detail: string | null } => item !== null),
    comparable: firstString(record["comparable"], record["comparison"]),
  };
}

function normalizeScoreboard(value: unknown): ScoreboardView | null {
  const record = asRecord(value);
  const categories = asRecordArray(record["categories"])
    .map((entry): ScoreboardCategoryView | null => {
      const key = asString(entry["key"]);
      if (!key) return null;
      const max = asNumber(entry["max"]);
      if (max === null) return null;
      const measured = asBoolean(entry["measured"]) ?? asNumber(entry["points"]) !== null;
      return {
        key,
        label: firstString(entry["label"]) ?? key,
        points: measured ? asNumber(entry["points"]) : null,
        max,
        measured,
        rationale: firstString(entry["rationale"]) ?? "",
        evidence: asStringArray(entry["evidence"]),
      };
    })
    .filter((entry): entry is ScoreboardCategoryView => entry !== null);
  if (categories.length === 0) return null;
  return {
    overall: clampScore(asNumber(record["overall"])),
    points: asNumber(record["points"]) ?? 0,
    measuredMax: asNumber(record["measuredMax"] ?? record["measured_max"]) ?? 0,
    categories,
  };
}

function normalizeAnalysis(value: unknown): ReportAnalysisMeta | null {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return null;
  const stages = asRecordArray(record["stages"])
    .map((entry): ReportAnalysisStage | null => {
      const key = asString(entry["key"]);
      if (!key) return null;
      return {
        key,
        label: firstString(entry["label"]) ?? key,
        state: asString(entry["state"]) ?? "pending",
        detail: firstString(entry["detail"]),
      };
    })
    .filter((entry): entry is ReportAnalysisStage => entry !== null);
  const errorRecord = asRecord(record["error"]);
  const error = Object.keys(errorRecord).length
    ? {
        code: asString(errorRecord["code"]) ?? "unexpected",
        message: asString(errorRecord["message"]) ?? "The analysis failed.",
        hint: asString(errorRecord["hint"]),
      }
    : null;
  return {
    state: asString(record["state"]),
    stages,
    error,
    limitations: asStringArray(record["limitations"]),
    startedAt: firstString(record["started_at"]),
    completedAt: firstString(record["completed_at"]),
  };
}

/**
 * Normalise a `report_data` payload into a renderable view model.
 *
 * Accepts `unknown` because storage may hand back anything (legacy demo shape,
 * structured analyst shape, `null`, or a partially written object).
 */
export function normalizeReportData(raw: unknown): ReportView {
  const data = asRecord(raw);
  // The analysis pipeline nests everything the judge submitted under
  // `submission`, so document analysis is looked up both there and at the top
  // level (older/hand-built payloads).
  const submissionRaw = asRecord(data["submission"]);
  const documentAnalysisRaw =
    data["document_analysis"] ?? data["documentAnalysis"] ?? submissionRaw["document_analysis"];

  const overviewRaw = asRecord(data["overview"]);
  const archRaw = asRecord(data["architecture"]);
  const codeRaw = asRecord(data["codeQuality"] ?? data["code_quality"]);
  const securityRaw = asRecord(data["security"]);
  const performanceRaw = asRecord(data["performance"]);
  const maintainabilityRaw = asRecord(data["maintainability"]);
  const documentationRaw = asRecord(data["documentation"]);
  const testingRaw = asRecord(data["testing"]);
  const scoresRaw = asRecord(data["scores"]);

  const repository = normalizeRepository(
    data["repositoryDetail"] ?? data["repository"] ?? data["repoDetail"],
  );
  const website = normalizeWebsite(data["websiteDetail"] ?? data["website"]);
  const innovation = normalizeInnovation(data["innovation"]);

  const overviewRepoUrl = firstString(
    data["repoUrl"],
    data["repo_url"],
    overviewRaw["repoUrl"],
    repository?.url,
  );
  const overviewWebsiteUrl = firstString(
    data["websiteUrl"],
    data["website_url"],
    overviewRaw["websiteUrl"],
    website?.url,
  );

  const metrics = normalizeMetrics(data["metrics"]);

  const scores: ReportScoreSet = {
    overall: clampScore(
      firstNumber(
        scoresRaw["overall"],
        data["overall"],
        data["overallScore"],
        data["overall_score"],
      ),
    ),
    evidence: clampScore(
      firstNumber(scoresRaw["evidence"], data["evidence"], data["evidenceScore"]),
    ),
    codeQuality: clampScore(
      firstNumber(
        scoresRaw["codeQuality"],
        scoresRaw["code_quality"],
        codeRaw["score"],
        repository?.testCoveragePct,
      ),
    ),
    security: clampScore(firstNumber(scoresRaw["security"], securityRaw["score"])),
    performance: clampScore(
      firstNumber(
        scoresRaw["performance"],
        performanceRaw["score"],
        website?.lighthouse.find((l) => l.name.toLowerCase().includes("performance"))?.score,
      ),
    ),
    maintainability: clampScore(
      firstNumber(scoresRaw["maintainability"], maintainabilityRaw["score"]),
    ),
    testing: clampScore(firstNumber(scoresRaw["testing"], testingRaw["score"])),
    documentation: clampScore(firstNumber(scoresRaw["documentation"], documentationRaw["score"])),
    innovation: clampScore(
      firstNumber(scoresRaw["innovation"], innovation?.score, data["innovationScore"]),
    ),
  };

  const codeFindings = asStringArray(codeRaw["findings"]);
  const securityFindings = normalizeRisks(securityRaw["findings"] ?? securityRaw["issues"]);
  const risks = normalizeRisks(data["risks"] ?? data["findings"]);

  const recommendations = normalizeRecommendations(
    data["recommendations"] ?? data["improvements"] ?? data["suggestions"],
  );

  const architectureStack = normalizeStack(
    archRaw["stack"] ??
      archRaw["technologyStack"] ??
      archRaw["techStack"] ??
      data["techStack"] ??
      overviewRaw["techStack"],
  );

  const executiveSummary = firstString(
    data["executiveSummary"],
    data["executive_summary"],
    data["summary"],
    overviewRaw["summary"],
  );

  const architectureSummary = firstString(archRaw["summary"], archRaw["overview"]);

  const codeSummary = firstString(codeRaw["summary"], codeRaw["overview"]);
  const securitySummary = firstString(securityRaw["summary"], securityRaw["overview"]);
  const performanceSummary = firstString(performanceRaw["summary"], performanceRaw["overview"]);
  const maintainabilitySummary = firstString(
    maintainabilityRaw["summary"],
    maintainabilityRaw["overview"],
  );

  const performanceVitals = normalizeVitals(
    performanceRaw["vitals"] ??
      performanceRaw["coreWebVitals"] ??
      performanceRaw["core_web_vitals"] ??
      website?.vitals,
  );
  const lighthouse = normalizeLighthouse(
    performanceRaw["lighthouse"] ??
      website?.lighthouse?.reduce<Record<string, unknown>>((acc, entry) => {
        acc[entry.name.replace(/\s+/g, "")] = entry.score;
        return acc;
      }, {}),
  );

  const claims = normalizeClaims(data["claims"] ?? data["features"]);
  const claimCounts = normalizeClaimCounts(data["claim_counts"] ?? data["claimCounts"], claims);
  const claimPipeline = normalizeClaimPipeline(data["claim_pipeline"] ?? data["claimPipeline"]);

  const view: ReportView = {
    executiveSummary,
    overview: {
      summary: firstString(overviewRaw["summary"], data["summary"], executiveSummary),
      highlights: asStringArray(
        overviewRaw["highlights"] ??
          overviewRaw["keyPoints"] ??
          data["highlights"] ??
          data["strengths"],
      ),
      techStack: asStringArray(overviewRaw["techStack"] ?? data["techStack"]).concat(
        architectureStack.map((entry) => entry.name),
      ),
      repoUrl: overviewRepoUrl,
      websiteUrl: overviewWebsiteUrl,
    },
    architecture: {
      summary: architectureSummary,
      stack: architectureStack,
      layers: normalizeLayers(archRaw["layers"] ?? archRaw["components"]),
      decisions: asStringArray(archRaw["decisions"] ?? archRaw["tradeoffs"]),
    },
    codeQuality: {
      summary: codeSummary,
      findings: codeFindings,
      coveragePct: firstNumber(
        codeRaw["coveragePct"],
        codeRaw["coverage_pct"],
        codeRaw["coverage"],
        repository?.testCoveragePct,
      ),
      notes: asStringArray(codeRaw["notes"] ?? repository?.notes),
    },
    security: {
      summary: securitySummary,
      findings: securityFindings,
    },
    performance: {
      summary: performanceSummary,
      lighthouse,
      vitals: performanceVitals,
      pageWeightMb: firstNumber(
        performanceRaw["pageWeightMb"],
        performanceRaw["page_weight_mb"],
        website?.pageWeightMb,
      ),
    },
    maintainability: {
      summary: maintainabilitySummary,
      notes: asStringArray(
        maintainabilityRaw["notes"] ??
          maintainabilityRaw["findings"] ??
          data["maintainabilityNotes"],
      ),
    },
    documentation: {
      summary: firstString(documentationRaw["summary"], documentationRaw["overview"]),
      notes: asStringArray(documentationRaw["notes"] ?? documentationRaw["evidence"]),
    },
    testing: {
      summary: firstString(testingRaw["summary"], testingRaw["overview"]),
      notes: asStringArray(testingRaw["notes"] ?? testingRaw["evidence"]),
    },
    risks,
    recommendations,
    metrics,
    scores,
    repository,
    website,
    claims,
    claimCounts,
    claimPipeline,
    documentAnalysis: normalizeDocumentAnalysis(documentAnalysisRaw),
    evidence: normalizeEvidenceSummary(data["evidence"] ?? data["evidence_summary"]),
    innovation,
    timeline: normalizeTimeline(data["timeline"]),
    interviewQuestions: asStringArray(data["interviewQuestions"] ?? data["interview_questions"]),
    judgeQuestions: asStringArray(data["judgeQuestions"] ?? data["judge_questions"]),
    scoreboard: normalizeScoreboard(data["scoreboard"]),
    analysis: normalizeAnalysis(data["analysis"]),
    present: {
      executiveSummary: executiveSummary !== null,
      overview: Object.keys(overviewRaw).length > 0 || executiveSummary !== null,
      architecture: architectureStack.length > 0 || architectureSummary !== null,
      codeQuality:
        codeSummary !== null ||
        codeFindings.length > 0 ||
        (repository?.notes.length ?? 0) > 0 ||
        firstNumber(
          codeRaw["coveragePct"],
          codeRaw["coverage_pct"],
          repository?.testCoveragePct,
        ) !== null,
      security: securitySummary !== null || securityFindings.length > 0,
      performance:
        performanceSummary !== null ||
        performanceVitals.length > 0 ||
        lighthouse.some((entry) => entry.score !== null),
      maintainability: maintainabilitySummary !== null,
      documentation: firstString(documentationRaw["summary"]) !== null,
      testing: firstString(testingRaw["summary"]) !== null,
      risks: risks.length > 0 || securityFindings.length > 0,
      recommendations: recommendations.length > 0,
      documentAnalysis: normalizeDocumentAnalysis(documentAnalysisRaw) !== null,
      overallScore: scores.overall !== null || normalizeScoreboard(data["scoreboard"]) !== null,
    },
    hasPayloadData: Object.keys(data).length > 0,
  };

  // De-duplicate the merged tech stack while keeping order.
  view.overview.techStack = [...new Set(view.overview.techStack.filter(Boolean))];

  return view;
}

/* ---------------------------------------------------------------- status */

export interface StatusMeta {
  kind: ReportStatusKind;
  label: string;
  description: string;
  tone: "success" | "warning" | "destructive" | "muted";
  badgeClass: string;
}

const STATUS_META: Record<ReportStatusKind, StatusMeta> = {
  completed: {
    kind: "completed",
    label: "Completed",
    description: "Analysis finished — findings below are based on the collected evidence.",
    tone: "success",
    badgeClass: "border-success/30 bg-success/10 text-success",
  },
  in_progress: {
    kind: "in_progress",
    label: "In Progress",
    description: "Analysis is still running — scores and findings are not final yet.",
    tone: "warning",
    badgeClass: "border-warning/30 bg-warning/10 text-warning",
  },
  failed: {
    kind: "failed",
    label: "Failed",
    description: "Analysis could not complete — any findings shown are partial.",
    tone: "destructive",
    badgeClass: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  unknown: {
    kind: "unknown",
    label: "Unknown",
    description: "The status of this report is not available.",
    tone: "muted",
    badgeClass: "border-muted bg-muted/50 text-muted-foreground",
  },
};

export function normalizeReportStatus(status: string | null | undefined): StatusMeta {
  if (status === "Completed") return STATUS_META.completed;
  if (status === "In Progress") return STATUS_META.in_progress;
  if (status === "Failed") return STATUS_META.failed;
  return STATUS_META.unknown;
}

/** True when the payload is empty enough that the report is only a placeholder. */
export function isReportEmpty(view: ReportView): boolean {
  return !view.hasPayloadData;
}

// `Json` is re-exported for callers building payloads next to this module.
export type ReportDataJson = Json;
