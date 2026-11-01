/**
 * The reads both portals share.
 *
 * One candidate submission is the single source of truth: the candidate status
 * page, the judge's hackathon workspace and the project page all read the same
 * `hackathon_submissions` row (plus the analysis report it points at). Nothing is
 * copied between the portals and nothing is re-entered by the judge.
 *
 * Privacy is part of the contract, not the UI: the candidate read never returns
 * a judge score, a private note or an unpublished result, and the judge read never
 * returns another judge's private notes (that filter lives in the evaluations
 * service and in the database's RLS policy).
 */

import { normalizeReportData, type ReportView } from "@/lib/report-data";
import type {
  Hackathon,
  HackathonSubmission,
  PublishedResult,
  SubmissionStatus,
} from "@/types/hackathon";
import type { CriteriaSet, ImprovementSuggestion, JudgeEvaluation } from "@/types/evaluation";
import { buildImprovementSuggestions } from "@/services/inspection/copilot";
import { awardedTotal, criterionTargets } from "@/lib/evaluation/scoring";
import {
  findHackathonByCode,
  getSubmissionForCandidate,
  getSubmissionForJudge,
  isStatusAtLeast,
  listJudgeHackathons,
  listJudgeSubmissions,
  listUnassignedSubmissions,
  portalJudgeId,
  submissionStatusLabel,
} from "@/services/hackathon.service";
import { listEvaluations } from "@/services/judging/evaluations.service";
import { getGuestReport } from "@/services/guest.service";
import { getReport } from "@/services/report.service";
import type { Report } from "@/types/database";

export interface PortalViewer {
  userId: string | null;
  isGuest: boolean;
}

/* ----------------------------------------------------------------- reports */

/**
 * The report behind a submission, read by whoever is allowed to read it.
 *
 * Signed-in judges read through the submission policy; guests read this
 * browser's journal (their submissions never leave it). A failure is `null` —
 * the pages then say "analysis not available" instead of inventing a score.
 */
async function readReport(reportId: string | null, _viewer: PortalViewer): Promise<Report | null> {
  if (!reportId) return null;
  // Browser-local reports first: a guest's submission never left this browser.
  const local = getGuestReport(reportId);
  if (local) return local as unknown as Report;
  try {
    return await getReport(reportId);
  } catch {
    return null;
  }
}

export type AnalysisReadiness = "not_started" | "running" | "ready" | "failed";

function readinessOf(report: Report | null): AnalysisReadiness {
  if (!report) return "not_started";
  if (report.status === "Completed") return "ready";
  if (report.status === "Failed") return "failed";
  if (report.status === "In Progress") return "running";
  return "not_started";
}

function aiScoreOf(report: Report | null): number | null {
  if (!report) return null;
  const view = normalizeReportData(report.report_data);
  const score = view.scoreboard?.overall ?? view.scores.overall;
  if (score !== null) return Math.round(score);
  return typeof report.score === "number" && Number.isFinite(report.score)
    ? Math.round(report.score)
    : null;
}

/* -------------------------------------------------------------- evaluations */

function evaluationTotal(
  record: JudgeEvaluation,
  fallback: CriteriaSet,
): { total: number; max: number } | null {
  const snapshot = record.criteriaSnapshot;
  const targets = criterionTargets(
    snapshot && snapshot.criteria.length > 0
      ? { ...fallback, maxScore: snapshot.maxScore, criteria: snapshot.criteria }
      : fallback,
  );
  if (targets.length === 0) return null;
  const max = snapshot?.maxScore ?? fallback.maxScore;
  return { total: awardedTotal(record.scores, targets), max };
}

/** The hackathon's own rubric, in the shape the scoring helpers expect. */
function criteriaOf(hackathon: Hackathon): CriteriaSet {
  return {
    category: "project",
    maxScore: hackathon.maxScore,
    criteria: hackathon.criteria,
    updatedAt: hackathon.updatedAt,
  };
}

/* ------------------------------------------------------------ judge portal */

export interface JudgeSubmissionRow {
  submission: HackathonSubmission;
  /** The project name the candidate submitted (from its report), when readable. */
  projectName: string | null;
  analysis: AnalysisReadiness;
  aiScore: number | null;
  judgeScore: number | null;
  judgeMax: number | null;
  /** True when the judge has a saved draft but has not submitted it. */
  judgeDraft: boolean;
  finalScore: number | null;
  finalMax: number;
}

export interface HackathonWorkspace {
  hackathon: Hackathon;
  rows: JudgeSubmissionRow[];
  counts: {
    submissions: number;
    evaluated: number;
    pending: number;
    needsReview: number;
  };
}

/** One hackathon plus every submission the judge may see, ready for the table. */
export async function fetchHackathonWorkspace(
  code: string,
  viewer: PortalViewer,
): Promise<HackathonWorkspace | null> {
  const judgeId = portalJudgeId(viewer.userId);
  const hackathon = await findHackathonByCode(code, viewer.userId).catch(() => null);
  if (!hackathon) return null;

  // A judge only reads hackathons they organize or are assigned to; `listJudgeSubmissions`
  // applies that rule, so an unknown code simply yields no rows.
  const allowed = await listJudgeHackathons(judgeId).catch(() => []);
  if (!allowed.some((entry) => entry.id === hackathon.id)) return null;

  const [submissions, evaluations] = await Promise.all([
    listJudgeSubmissions(judgeId, hackathon.id).catch(() => []),
    listEvaluations("project", judgeId).catch(() => []),
  ]);

  const criteria = criteriaOf(hackathon);
  const reports = await Promise.all(
    submissions.map(({ submission }) => readReport(submission.reportId, viewer)),
  );

  const rows: JudgeSubmissionRow[] = submissions.map(({ submission }, index) => {
    const report = reports[index] ?? null;
    const analysis = readinessOf(report);
    const aiScore = aiScoreOf(report);
    const mine = evaluations.filter(
      (record) => record.submissionId === `project:${submission.id}` && record.judgeId === judgeId,
    );
    const submitted = mine.find((record) => record.status !== "in_progress") ?? null;
    const draft = mine.find((record) => record.status === "in_progress") ?? null;
    const total = submitted ? evaluationTotal(submitted, criteria) : null;
    const published = submission.resultPublished ? submission.publishedResult : null;
    const finalMax = published?.maxScore ?? total?.max ?? criteria.maxScore;

    return {
      submission,
      projectName: report?.name ?? null,
      analysis,
      aiScore,
      judgeScore: total?.total ?? null,
      judgeMax: total?.max ?? null,
      judgeDraft: Boolean(draft) && !submitted,
      finalScore:
        published?.total ??
        total?.total ??
        (submission.status === "evaluated" || submission.status === "finalized" ? aiScore : null),
      finalMax,
    };
  });

  const evaluated = rows.filter((row) => row.judgeScore !== null).length;
  const needsReview = rows.filter(
    (row) => row.judgeScore === null && row.analysis === "ready",
  ).length;

  return {
    hackathon,
    rows,
    counts: {
      submissions: rows.length,
      evaluated,
      pending: rows.length - evaluated - needsReview,
      needsReview,
    },
  };
}

export interface JudgeProject {
  hackathon: Hackathon;
  submission: HackathonSubmission;
  /** The project name the candidate entered (falls back to the team name). */
  projectName: string;
  reportId: string | null;
  analysis: {
    readiness: AnalysisReadiness;
    score: number | null;
    view: ReportView | null;
  };
  myEvaluation: JudgeEvaluation | null;
  evaluations: JudgeEvaluation[];
  criteria: CriteriaSet;
}

/** One submission as the judge's project page needs it. */
export async function fetchJudgeProject(
  code: string,
  submissionId: string,
  viewer: PortalViewer,
): Promise<JudgeProject | null> {
  const judgeId = portalJudgeId(viewer.userId);
  const row = await getSubmissionForJudge(submissionId, judgeId).catch(() => null);
  if (!row) return null;
  // The page is scoped by code: a submission opened under the wrong hackathon is
  // not the page the judge meant, so it is treated as missing. Unassigned ones
  // have no page here — they are filed first, from the intake list.
  if (!row.hackathon) return null;
  if (row.hackathon.code.toUpperCase() !== code.trim().toUpperCase()) return null;

  const report = await readReport(row.submission.reportId, viewer);
  const evaluations = (await listEvaluations("project", judgeId).catch(() => [])).filter(
    (record) => record.submissionId === `project:${row.submission.id}`,
  );

  return {
    hackathon: row.hackathon,
    submission: row.submission,
    projectName: report?.name ?? row.submission.teamName,
    reportId: row.submission.reportId,
    analysis: {
      readiness: readinessOf(report),
      score: aiScoreOf(report),
      view: report ? normalizeReportData(report.report_data) : null,
    },
    myEvaluation: evaluations.find((record) => record.judgeId === judgeId) ?? null,
    evaluations,
    criteria: criteriaOf(row.hackathon),
  };
}

/** The docs URL for a submission — used by both portals' links. */
export function reportHref(reportId: string | null): string | null {
  return reportId ? `/report/${reportId}` : null;
}

/* -------------------------------------------------------- candidate portal */

export type CheckState = "ok" | "warn" | "unknown";

export interface SubmissionCheck {
  key: string;
  label: string;
  state: CheckState;
  detail: string;
}

export type StepState = "done" | "active" | "pending" | "unavailable";

export interface SubmissionStep {
  key: string;
  label: string;
  state: StepState;
  detail: string;
}

export interface CandidateStatus {
  /** `null` when the project was submitted without a hackathon code. */
  hackathon: Hackathon | null;
  submission: HackathonSubmission;
  /** The project name the candidate entered (falls back to the team name). */
  projectName: string;
  statusLabel: string;
  checks: SubmissionCheck[];
  steps: SubmissionStep[];
  /** Only present once a judge has published it. */
  result: PublishedResult | null;
  /**
   * Candidate-safe improvements derived from the published analysis.
   * Never judge notes, scores or rankings — only what to fix and why.
   */
  suggestions: ImprovementSuggestion[];
}

function stepStates(
  submission: HackathonSubmission,
  view: ReportView | null,
  readiness: AnalysisReadiness,
): SubmissionStep[] {
  const finished = isStatusAtLeast(submission.status, "evaluated");
  const analyzed = readiness === "ready";
  const running = readiness === "running" || submission.status === "processing";
  const claims = view?.claimCounts.total ?? 0;
  const pipeline = view?.claimPipeline ?? null;
  const documentRead = Boolean(view?.documentAnalysis);
  const repositoryRead = Boolean(view?.evidence?.repository ?? view?.repository);
  const deploymentMeasured =
    (view?.performance.vitals.length ?? 0) > 0 || (view?.website?.vitals.length ?? 0) > 0;

  const state = (done: boolean): StepState => (done ? "done" : "pending");

  return [
    {
      key: "received",
      label: "Submission received",
      state: "done",
      detail: new Date(submission.submittedAt).toLocaleString(),
    },
    {
      key: "documents",
      label: "Documents processed",
      state: state(documentRead),
      detail: documentRead
        ? `${view?.documentAnalysis?.fileName ?? "Deck"} · ${view?.documentAnalysis?.totalPages ?? "?"} pages`
        : running
          ? "Reading the submitted deck…"
          : submission.deckName
            ? "Deck received — waiting for the analysis run"
            : "No deck was attached",
    },
    {
      key: "repository",
      label: "Repository analyzed",
      state: state(repositoryRead),
      detail: repositoryRead
        ? `${view?.evidence?.filesListed ?? "?"} files listed`
        : submission.repoUrl
          ? "Waiting for the repository inspection"
          : "No repository was submitted",
    },
    {
      key: "deployment",
      label: "Deployment tested",
      state: deploymentMeasured ? "done" : analyzed ? "unavailable" : "pending",
      detail: deploymentMeasured
        ? "Runtime metrics were recorded for the deployed site."
        : submission.websiteUrl
          ? "The analysis reads documents and code; the deployed site was not executed."
          : "No deployment URL was submitted.",
    },
    {
      key: "claims",
      label: "Claims verified",
      state: claims > 0 ? "done" : analyzed ? "unavailable" : "pending",
      detail:
        claims > 0
          ? `${claims} claims checked · ${view?.claimCounts.supported ?? 0} supported${pipeline?.verified ? ` · ${pipeline.verified} decided` : ""}`
          : analyzed
            ? "No claims could be extracted from the submission."
            : "Waiting for the analysis run",
    },
    {
      key: "evaluation",
      label: "Evaluation ready",
      state: finished ? "done" : analyzed ? "active" : "pending",
      detail: finished
        ? "A judge has completed the evaluation."
        : "Judges score the project after the analysis finishes.",
    },
  ];
}

function submissionChecks(
  submission: HackathonSubmission,
  view: ReportView | null,
  readiness: AnalysisReadiness,
): SubmissionCheck[] {
  const doc = view?.documentAnalysis;
  const evidence = view?.evidence;
  const website = view?.website;

  return [
    {
      key: "deck",
      label: "PPT uploaded",
      state: submission.deckName || doc ? "ok" : "warn",
      detail: submission.deckName ?? doc?.fileName ?? "No deck was attached.",
    },
    {
      key: "repo",
      label: "GitHub repository connected",
      state: submission.repoUrl ? "ok" : "warn",
      detail: submission.repoUrl ?? "No repository URL was submitted.",
    },
    {
      key: "deployment",
      label: "Deployment URL provided",
      state: submission.websiteUrl ? "ok" : "warn",
      detail: submission.websiteUrl ?? "No deployment URL was submitted.",
    },
    {
      key: "readme",
      label: "README detected",
      state: readiness !== "ready" ? "unknown" : evidence?.readmePath ? "ok" : "warn",
      detail:
        readiness !== "ready"
          ? "Checked when the repository analysis finishes."
          : (evidence?.readmePath ?? "No README was found in the repository root."),
    },
    {
      key: "reachable",
      label: "Deployment reachable",
      state: !submission.websiteUrl
        ? "warn"
        : website?.status
          ? "ok"
          : readiness === "ready"
            ? "warn"
            : "unknown",
      detail: website?.status
        ? `${website.url ?? submission.websiteUrl} · ${website.status}`
        : submission.websiteUrl
          ? readiness === "ready"
            ? "The deployed site was not loaded by this analysis."
            : "Checked when the analysis finishes."
          : "No deployment URL was submitted.",
    },
  ];
}

/**
 * The candidate's own view of one submission.
 *
 * Deliberately narrow: project, hackathon, lifecycle, submission checks and — only
 * when a judge has published it — the result. No judge scores, notes or rankings
 * ever cross this boundary.
 */
export async function fetchCandidateStatus(
  submissionId: string,
  candidateId: string,
  viewer: PortalViewer,
): Promise<CandidateStatus | null> {
  const row = await getSubmissionForCandidate(submissionId, candidateId).catch(() => null);
  if (!row) return null;

  const report = await readReport(row.submission.reportId, viewer);
  const readiness = readinessOf(report);
  const view = report ? normalizeReportData(report.report_data) : null;

  return {
    hackathon: row.hackathon,
    submission: row.submission,
    projectName: report?.name ?? row.submission.teamName,
    statusLabel: submissionStatusLabel(row.submission.status),
    checks: submissionChecks(row.submission, view, readiness),
    steps: stepStates(row.submission, view, readiness),
    result: row.submission.resultPublished ? row.submission.publishedResult : null,
    suggestions: view ? buildImprovementSuggestions(view) : [],
  };
}

/**
 * The intake pool: projects submitted without a code, as the judge sees them.
 *
 * Same read layer as everything else — the rows are the candidate's real
 * submission records, and assigning one only changes its `hackathon_id`.
 */
export interface UnassignedSubmissionRow {
  submission: HackathonSubmission;
  projectName: string | null;
  analysis: AnalysisReadiness;
  aiScore: number | null;
  reportId: string | null;
}

export async function fetchUnassignedSubmissions(
  viewer: PortalViewer,
): Promise<UnassignedSubmissionRow[]> {
  const judgeId = portalJudgeId(viewer.userId);
  const submissions = await listUnassignedSubmissions(judgeId).catch(() => []);
  const reports = await Promise.all(
    submissions.map(({ submission }) => readReport(submission.reportId, viewer)),
  );

  return submissions.map(({ submission }, index) => {
    const report = reports[index] ?? null;
    return {
      submission,
      projectName: report?.name ?? null,
      analysis: readinessOf(report),
      aiScore: aiScoreOf(report),
      reportId: submission.reportId,
    };
  });
}

/** Statuses a candidate may see on their own page (judge-side states are mapped). */
export function candidateFacingStatus(status: SubmissionStatus): string {
  if (status === "under_review") return "Under review by the judges";
  return submissionStatusLabel(status);
}
