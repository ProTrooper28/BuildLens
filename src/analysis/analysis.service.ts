/**
 * Project analysis pipeline.
 *
 * Runs deterministic analyzers over a public repository and produces the
 * `report_data` payload consumed by the report page. The pipeline is
 * persistence-agnostic: the caller supplies an `AnalysisPersistence` adapter so
 * authenticated reports are written to Supabase and guest reports to the guest
 * store — guest data is never converted into authenticated rows.
 *
 * No credentials are used. Only public, unauthenticated repository endpoints are
 * called, so nothing privileged ever reaches the browser bundle.
 */

import type { Json, ReportStatus } from "@/types/database";
import {
  AnalysisError,
  ANALYSIS_STAGES,
  type AnalysisErrorPayload,
  type AnalysisInput,
  type AnalysisStage,
  type AnalysisStageKey,
  type AnalysisStageState,
  type RepositorySnapshot,
} from "@/analysis/types";
import { fetchRepositorySnapshot, parseRepositoryUrl } from "@/repository/repository.service";
import { analyzeStack, type StackAnalysis } from "@/analysis/analyzers/stack.analyzer";
import { analyzeQuality, type QualityAnalysis } from "@/analysis/analyzers/quality.analyzer";
import { analyzeSecurity, type SecurityAnalysis } from "@/analysis/analyzers/security.analyzer";
import { analyzeTesting, type TestingAnalysis } from "@/analysis/analyzers/testing.analyzer";
import {
  analyzeDocumentation,
  type DocumentationAnalysis,
} from "@/analysis/analyzers/documentation.analyzer";
import {
  analyzeMaintainability,
  type MaintainabilityAnalysis,
} from "@/analysis/analyzers/maintainability.analyzer";
import { computeScoreboard, scoreBand, type Scoreboard } from "@/analysis/score";
import { documentAnalysisPayloadOf } from "@/services/document";
import {
  computeEvidenceScore,
  countClaims,
  featureClaimSupport,
  registerClaims,
  type NormalizedClaim,
  type RegisteredClaims,
} from "@/services/claims";

const TOTAL_BUDGET_MS = 45_000;

export interface AnalysisPersistence {
  update(patch: { status: ReportStatus; score: number | null; report_data: Json }): Promise<void>;
}

export interface AnalysisRunResult {
  status: Extract<ReportStatus, "Completed" | "Failed">;
  score: number | null;
  reportData: Json;
  error: AnalysisErrorPayload | null;
  stages: AnalysisStage[];
}

export interface RunAnalysisOptions {
  input: AnalysisInput;
  persistence: AnalysisPersistence;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  onStages?: (stages: AnalysisStage[]) => void;
}

/**
 * Analysis performs outbound network requests. Test environments must not hit the
 * network, so callers check this before starting a run; the pipeline itself is
 * covered directly by unit tests with an injected fetch.
 */
export function canRunAnalysis(): boolean {
  return typeof window !== "undefined" && import.meta.env.MODE !== "test";
}

function initialStages(): AnalysisStage[] {
  return ANALYSIS_STAGES.map((stage) => ({ ...stage, state: "pending", detail: null }));
}

function nowIso(): string {
  return new Date().toISOString();
}

interface PayloadContext {
  input: AnalysisInput;
  stages: AnalysisStage[];
  startedAt: string;
  completedAt: string | null;
  state: "running" | "completed" | "failed";
  error: AnalysisErrorPayload | null;
  limitations: string[];
  snapshot: RepositorySnapshot | null;
  stack: StackAnalysis | null;
  quality: QualityAnalysis | null;
  security: SecurityAnalysis | null;
  testing: TestingAnalysis | null;
  documentation: DocumentationAnalysis | null;
  maintainability: MaintainabilityAnalysis | null;
  score: number | null;
  /** Evidence-based six-category score breakdown (null until the score is computed). */
  scoreboard: Scoreboard | null;
  /** Claims extracted + registered + verified so far (null until that stage runs). */
  registeredClaims: RegisteredClaims | null;
}

/** Registered claim → the payload shape the report reads. */
function claimPayload(claim: NormalizedClaim): Json {
  return {
    id: claim.id,
    claim: claim.claim,
    source: claim.source,
    source_location: claim.sourceLocation,
    sources: claim.sources.map((entry) => ({
      source: entry.source,
      location: entry.location,
    })),
    evidence: claim.evidence,
    category: claim.category,
    confidence: claim.confidence,
    status: claim.verificationStatus,
    reason: claim.verificationReason,
  } as Json;
}

/** Build the `report_data` payload from whatever stages have completed. */
function buildReportData(context: PayloadContext): Json {
  const {
    input,
    stages,
    startedAt,
    completedAt,
    state,
    error,
    limitations,
    snapshot,
    stack,
    quality,
    security,
    testing,
    documentation,
    maintainability,
    score,
    scoreboard,
    registeredClaims,
  } = context;

  const claims = registeredClaims?.claims ?? [];

  const languages = snapshot?.metadata.languages ?? [];
  const frameworks = stack?.frameworks ?? [];

  const highlights: string[] = [];
  if (snapshot) {
    highlights.push(`Analyzed ${snapshot.metadata.fullName} at ${snapshot.metadata.defaultBranch}`);
    highlights.push(
      `${snapshot.files.length} file${snapshot.files.length === 1 ? "" : "s"} listed${snapshot.truncated ? " (listing truncated)" : ""}`,
    );
  }
  if (languages.length > 0) {
    highlights.push(
      `Languages: ${languages
        .slice(0, 4)
        .map((l) => `${l.name} ${l.pct}%`)
        .join(", ")}`,
    );
  }
  for (const framework of frameworks.slice(0, 4))
    highlights.push(`${framework.name} — ${framework.evidence}`);
  if (testing && testing.testFiles > 0) {
    highlights.push(`${testing.testFiles} test file${testing.testFiles === 1 ? "" : "s"} detected`);
  }

  const overviewSummary = snapshot
    ? (snapshot.metadata.description ??
      `${snapshot.metadata.fullName} was inspected from the public repository. ${stack?.summary ?? ""}`.trim())
    : null;

  const topLevel = new Map<string, number>();
  for (const file of snapshot?.files ?? []) {
    const top = file.path.includes("/") ? (file.path.split("/")[0] ?? "(root)") : "(root)";
    topLevel.set(top, (topLevel.get(top) ?? 0) + 1);
  }
  const layers = [...topLevel.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([name, count]) => ({ name, detail: `${count} file${count === 1 ? "" : "s"}` }));

  const risks: Json[] = [];
  for (const finding of security?.findingsDetailed ?? []) {
    risks.push({
      title: finding.title,
      severity: finding.severity,
      detail: finding.detail,
      mitigation: finding.mitigation,
    });
  }
  if (testing && testing.testFiles === 0 && (quality?.score ?? null) !== null) {
    risks.push({
      title: "No automated tests detected",
      severity: "medium",
      detail: "No test files matched the common test-file patterns in the repository listing.",
      mitigation: "Add unit or integration tests for the core behaviour.",
    });
  }
  if (snapshot && snapshot.readme === null) {
    risks.push({
      title: "No README found",
      severity: "low",
      detail: "The repository does not contain a README file, so setup and usage are undocumented.",
      mitigation: "Add a README describing setup, architecture and usage.",
    });
  }

  const recommendations: Json[] = [];
  const seen = new Set<string>();
  const pushRecommendation = (title: string, priority: string, detail: string | null) => {
    if (seen.has(title)) return;
    seen.add(title);
    recommendations.push({ title, priority, detail });
  };
  for (const finding of security?.findingsDetailed ?? []) {
    pushRecommendation(
      finding.mitigation,
      finding.severity === "critical" || finding.severity === "high" ? "high" : "medium",
      finding.title,
    );
  }
  if (testing && testing.testFiles === 0 && quality?.score !== null) {
    pushRecommendation(
      "Add automated tests",
      "high",
      "No test files were found in the repository.",
    );
  }
  if (documentation && documentation.readmePath === null) {
    pushRecommendation("Add a README", "medium", "A README was not found in the repository.");
  }
  pushRecommendation(
    "Measure runtime performance",
    "low",
    "Performance was not scored because no run-time measurement was performed.",
  );

  const totalStages = stages.length;
  const doneStages = stages.filter((stage) => stage.state === "done").length;

  return {
    version: 2,
    executive_summary:
      snapshot === null
        ? null
        : `${snapshot.metadata.fullName} was analyzed from its public repository on ${new Date(completedAt ?? startedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}. ${snapshot.files.length} files were listed${
            languages.length > 0
              ? ` (${languages
                  .slice(0, 3)
                  .map((l) => l.name)
                  .join(", ")})`
              : ""
          }.${frameworks.length > 0 ? ` Detected ${frameworks.map((f) => f.name).join(", ")}.` : ""}${score !== null ? ` Deterministic overall score: ${score}/100 (${scoreBand(score)}).` : " No overall score could be computed from the available evidence."}`,
    overview: {
      summary: overviewSummary,
      highlights,
      techStack: [...new Set([...languages.map((l) => l.name), ...frameworks.map((f) => f.name)])],
      repoUrl: snapshot?.ref.url ?? input.repoUrl,
      websiteUrl: input.websiteUrl,
    },
    architecture: {
      summary: stack?.summary ?? null,
      stack: [
        ...languages.map((language) => ({
          name: language.name,
          detail: `${language.pct}% of files`,
        })),
        ...frameworks.map((framework) => ({ name: framework.name, detail: framework.evidence })),
      ],
      layers,
      decisions: stack?.configFiles.map((file) => `Configuration: ${file}`) ?? [],
    },
    code_quality: {
      summary: quality?.summary ?? null,
      findings: quality?.findings ?? [],
      notes: quality?.evidence ?? [],
      coverage_pct: null,
    },
    security: {
      summary: security?.summary ?? null,
      findings: security?.findingsDetailed ?? [],
    },
    performance: {
      summary:
        "Not enough evidence — runtime performance requires executing the deployed site, which this analysis did not do.",
      vitals: [],
      lighthouse: {},
      page_weight_mb: null,
    },
    maintainability: {
      summary: maintainability?.summary ?? null,
      notes: maintainability?.notes ?? [],
    },
    documentation: {
      summary: documentation?.summary ?? null,
      notes: documentation?.evidence ?? [],
    },
    testing: {
      summary: testing?.summary ?? null,
      notes: testing?.evidence ?? [],
    },
    risks,
    recommendations,
    scores: {
      overall: score,
      evidence: computeEvidenceScore(claims),
      codeQuality: quality?.score ?? null,
      security: security?.score ?? null,
      performance: null,
      maintainability: maintainability?.score ?? null,
      testing: testing?.score ?? null,
      documentation: documentation?.score ?? null,
    },
    // The report leads with this breakdown: six categories, each with the points
    // it earned out of a fixed maximum, and never a number without evidence.
    scoreboard: scoreboard
      ? {
          overall: scoreboard.overall,
          points: scoreboard.points,
          measuredMax: scoreboard.measuredMax,
          categories: scoreboard.categories,
        }
      : null,
    evidence: {
      provider: snapshot?.ref.provider ?? null,
      repository: snapshot?.metadata.fullName ?? null,
      repository_url: snapshot?.ref.url ?? input.repoUrl,
      default_branch: snapshot?.metadata.defaultBranch ?? null,
      stars: snapshot?.metadata.stars ?? null,
      forks: snapshot?.metadata.forks ?? null,
      license: snapshot?.metadata.license ?? null,
      files_listed: snapshot?.files.length ?? null,
      inspected_at: snapshot?.inspectedAt ?? null,
      languages,
      frameworks,
      config_files: stack?.configFiles ?? [],
      package_manager: stack?.packageManager ?? null,
      test_files: testing?.testFiles ?? null,
      readme: documentation?.readmePath ?? null,
    },
    submission: {
      notes: input.notes,
      website_url: input.websiteUrl,
      attachments: input.attachments,
      // Claims extracted from the submitted deck — always labelled as claims
      // (see payload disclaimer), never merged into verified findings.
      document_analysis: documentAnalysisPayloadOf(input.document ?? null),
      created_at: input.createdAt,
    },
    // Registered claims: extracted from the deck and README, deduplicated and
    // verified against the inspected evidence. The report renders these — an
    // extracted claim can never be dropped between extraction and the report.
    claims: claims.map(claimPayload),
    claim_counts: countClaims(claims),
    claim_pipeline: registeredClaims?.stats ?? null,
    analysis: {
      state,
      started_at: startedAt,
      completed_at: completedAt,
      stages,
      stage_progress: { done: doneStages, total: totalStages },
      error,
      limitations,
    },
  } as unknown as Json;
}

class StageTracker {
  private stages = initialStages();

  constructor(private readonly timeoutMs: number) {}

  get list(): AnalysisStage[] {
    return this.stages.map((stage) => ({ ...stage }));
  }

  set(key: AnalysisStageKey, state: AnalysisStageState, detail: string | null = null): void {
    this.stages = this.stages.map((stage) =>
      stage.key === key ? { ...stage, state, detail } : stage,
    );
    this.assertWithinBudget();
  }

  fail(key: AnalysisStageKey, detail: string): void {
    this.stages = this.stages.map((stage) =>
      stage.key === key ? { ...stage, state: "failed", detail } : stage,
    );
  }

  private assertWithinBudget(): void {
    if (Date.now() - this.startedAt > this.timeoutMs) {
      throw new AnalysisError(
        "timeout",
        "The analysis took too long and was stopped.",
        "Very large repositories can exceed the time budget. Retry, or analyze a smaller branch.",
      );
    }
  }

  private readonly startedAt = Date.now();
}

/**
 * Run the full analysis for a submission.
 *
 * Analysis failures do not throw: they produce a `Failed` result with a
 * user-facing error so the project/report records are preserved. Only a failure
 * to persist the final result is propagated to the caller.
 */
export async function runProjectAnalysis({
  input,
  persistence,
  fetchImpl,
  onStages,
}: RunAnalysisOptions): Promise<AnalysisRunResult> {
  const startedAt = nowIso();
  const tracker = new StageTracker(TOTAL_BUDGET_MS);
  const limitations: string[] = [];
  let persistenceWarning: string | null = null;

  let snapshot: RepositorySnapshot | null = null;
  let stack: StackAnalysis | null = null;
  let quality: QualityAnalysis | null = null;
  let security: SecurityAnalysis | null = null;
  let testing: TestingAnalysis | null = null;
  let documentation: DocumentationAnalysis | null = null;
  let maintainability: MaintainabilityAnalysis | null = null;
  let score: number | null = null;
  let scoreboard: Scoreboard | null = null;
  let registeredClaims: RegisteredClaims | null = null;

  const emit = (state: "running" | "completed" | "failed", error: AnalysisErrorPayload | null) => {
    const payload = buildReportData({
      input,
      stages: tracker.list,
      startedAt,
      completedAt: state === "running" ? null : nowIso(),
      state,
      error,
      limitations: persistenceWarning ? [...limitations, persistenceWarning] : limitations,
      snapshot,
      stack,
      quality,
      security,
      testing,
      documentation,
      maintainability,
      score,
      scoreboard,
      registeredClaims,
    });
    onStages?.(tracker.list);
    return persistence
      .update({
        status: state === "failed" ? "Failed" : state === "completed" ? "Completed" : "In Progress",
        score,
        report_data: payload,
      })
      .then(() => payload)
      .catch((error: unknown) => {
        if (state === "running") {
          persistenceWarning =
            "Progress updates could not be saved; the final result will still be written.";
          return payload;
        }
        throw error;
      });
  };

  try {
    // 1. Validate the repository URL before any network request.
    tracker.set("validated", "active");
    const parsed = parseRepositoryUrl(input.repoUrl);
    if (!parsed.ok) throw parsed.error;
    tracker.set("validated", "done", parsed.ref.url);
    await emit("running", null);

    // 2. Fetch metadata and the file listing.
    tracker.set("inspected", "active");
    snapshot = await fetchRepositorySnapshot(parsed.ref, fetchImpl ? { fetchImpl } : {});
    limitations.push(...snapshot.limitations);
    tracker.set(
      "inspected",
      "done",
      `${snapshot.files.length} files · ${snapshot.metadata.defaultBranch}`,
    );
    await emit("running", null);

    // 3. Stack
    tracker.set("stack", "active");
    stack = analyzeStack(snapshot);
    limitations.push(...stack.limitations);
    tracker.set(
      "stack",
      "done",
      stack.frameworks.length > 0
        ? `${snapshot.metadata.languages.map((l) => l.name).join(", ")} · ${stack.frameworks.map((f) => f.name).join(", ")}`
        : snapshot.metadata.languages.map((l) => l.name).join(", ") || "No stack detected",
    );
    await emit("running", null);

    // 4. Code quality + maintainability
    tracker.set("quality", "active");
    quality = analyzeQuality(snapshot);
    maintainability = analyzeMaintainability(snapshot);
    limitations.push(...quality.limitations, ...maintainability.limitations);
    tracker.set(
      "quality",
      "done",
      quality.score === null ? "Not enough evidence" : `${quality.score}/100`,
    );
    await emit("running", null);

    // 5. Security
    tracker.set("security", "active");
    security = analyzeSecurity(snapshot);
    limitations.push(...security.limitations);
    tracker.set(
      "security",
      "done",
      security.findingsDetailed.length === 0
        ? "No configuration issues detected"
        : `${security.findingsDetailed.length} issue${security.findingsDetailed.length === 1 ? "" : "s"}`,
    );
    await emit("running", null);

    // 6. Documentation + testing
    tracker.set("documentation", "active");
    documentation = analyzeDocumentation(snapshot);
    testing = analyzeTesting(snapshot);
    limitations.push(...documentation.limitations, ...testing.limitations);
    tracker.set(
      "documentation",
      "done",
      `${testing.testFiles} test file${testing.testFiles === 1 ? "" : "s"} · ${documentation.readmePath ?? "no README"}`,
    );
    await emit("running", null);

    // 7. Claim extraction + registration (deck + README → one verified list)
    //    Runs before the score so unsupported claims can pull the overall down.
    tracker.set("report", "active");
    registeredClaims = registerClaims({
      document: input.document ?? null,
      readme: snapshot.readme,
      signals: {
        filePaths: snapshot.files.map((file) => file.path),
        frameworks: (stack?.frameworks ?? []).map((framework) => framework.name),
        languages: snapshot.metadata.languages.map((language) => language.name),
        readmeText: snapshot.readme?.text ?? null,
        // The analysis does not fetch the deployed site: runtime evidence is
        // collected by the inspection pipeline, and is empty here by design.
        liveEvidence: [],
      },
    });
    for (const line of registeredClaims.stats.log) console.debug(line);
    if (registeredClaims.stats.error) {
      limitations.push(registeredClaims.stats.error);
    }
    await emit("running", null);

    // 8. Scores + report
    //    Claims feed two categories (functionality and claim accuracy), so an
    //    unsupported claim lowers the score without a separate adjustment step.
    scoreboard = computeScoreboard({
      featureClaims: featureClaimSupport(registeredClaims.claims),
      claimEvidenceScore: computeEvidenceScore(registeredClaims.claims),
      codeQuality: quality.score,
      security: security.score,
      maintainability: maintainability.score,
      testing: testing.score,
      documentation: documentation.score,
      // The repository analysis never executes the deployed site, so runtime
      // performance stays unmeasured instead of being estimated.
      performance: null,
    });
    score = scoreboard.overall;
    tracker.set(
      "report",
      "done",
      `${registeredClaims.stats.registered} claim${registeredClaims.stats.registered === 1 ? "" : "s"} extracted · ${registeredClaims.stats.verified} verified · ${
        score === null ? "No score" : `Overall ${score}/100`
      }`,
    );
    const reportData = await emit("completed", null);

    return {
      status: "Completed",
      score,
      reportData,
      error: null,
      stages: tracker.list,
    };
  } catch (error) {
    const analysisError =
      error instanceof AnalysisError
        ? error
        : new AnalysisError(
            "unexpected",
            "The analysis stopped unexpectedly.",
            "Retry the analysis; if it keeps failing the repository may be unsupported.",
          );
    if (!(error instanceof AnalysisError)) console.error(error);

    const failedStage = tracker.list.find((stage) => stage.state === "active");
    if (failedStage) tracker.fail(failedStage.key, analysisError.message);

    const payload = await emit("failed", analysisError.toPayload());
    return {
      status: "Failed",
      score: null,
      reportData: payload,
      error: analysisError.toPayload(),
      stages: tracker.list,
    };
  }
}
