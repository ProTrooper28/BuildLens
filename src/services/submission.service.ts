/**
 * Candidate submission orchestration — the ordered writes behind "Submit".
 *
 * The order is a correctness requirement, not a UI detail:
 *
 *   project → report → hackathon submission → progress
 *
 * `hackathon_submissions.project_id` / `report_id` are foreign keys, so the
 * submission row cannot be written before the rows it points at exist, and the
 * database — not the browser — owns the ids those references use.
 *
 * Three rules make the flow safe to retry:
 *
 *   1. **Resume, never duplicate.** Before creating anything, the candidate's
 *      existing submissions are read. A retry (or a double-clicked button) reuses
 *      the project/report of the submission already filed for that hackathon (or
 *      the open unassigned one) instead of stacking a second project.
 *   2. **Never leave half a submission.** If a later step fails, the rows created
 *      by this attempt are removed again, so the candidate either has a complete
 *      submission or none — and the next retry starts clean.
 *   3. **The analysis pipeline never decides the submission's fate.** Progress
 *      bookkeeping runs after the submission exists and is logged, never thrown:
 *      a rejected status update cannot turn a stored submission into a reported
 *      failure.
 *
 * Failures are wrapped in {@link SubmissionError}, which keeps the original
 * database/auth error (message, SQLSTATE code, details, hint, HTTP status) so the
 * console shows what actually broke while the UI shows something readable.
 */

import { getSession } from "@/services/auth.service";
import {
  createGuestProject,
  createGuestReport,
  deleteGuestProject,
  deleteGuestReport,
} from "@/services/guest.service";
import {
  listCandidateSubmissions,
  submitToHackathon,
  syncSubmissionProgress,
} from "@/services/hackathon.service";
import {
  createCandidateProject,
  createProjectForUser,
  deleteProject,
} from "@/services/project.service";
import { createReportForUser, deleteReport } from "@/services/report.service";
import type { Json } from "@/types/database";
import type { Hackathon, SubmissionStatus } from "@/types/hackathon";

/* -------------------------------------------------------------------- types */

/** The step of the flow that failed — the first thing to look at in a log. */
export type SubmissionStep =
  "create-project" | "create-report" | "create-submission" | "sync-progress";

export interface SubmissionDraft {
  /** `auth.users.id` for a signed-in candidate, the local id for a guest. */
  candidateId: string;
  /** The event the project is filed under, or `null` for "unassigned". */
  hackathon: Hackathon | null;
  projectName: string;
  teamName: string;
  teamMembers: string[];
  description: string | null;
  repoUrl: string | null;
  websiteUrl: string | null;
  deckName: string | null;
  /** Persisted as `reports.report_data` (deck extraction + links + attachments). */
  reportData: Json;
}

export interface StoredProject {
  id: string;
  name: string;
  repoUrl: string | null;
  websiteUrl: string | null;
  description: string | null;
}

export interface StoredReport {
  id: string;
  createdAt: string;
}

/** Where a submission's rows live: the database, or a guest's browser. */
export interface SubmissionStore {
  readonly kind: "database" | "browser";
  createProject(draft: SubmissionDraft): Promise<StoredProject>;
  createReport(project: StoredProject, draft: SubmissionDraft): Promise<StoredReport>;
  /** Undo a partially created submission. Must not throw. */
  discard(created: { projectId: string | null; reportId: string | null }): Promise<void>;
}

export interface SubmissionOutcome {
  projectId: string;
  projectName: string;
  reportId: string;
  reportCreatedAt: string;
  /** `null` for project-manager work, which is never filed with the judges. */
  submissionId: string | null;
  hackathon: Hackathon | null;
  status: SubmissionStatus;
}

/* ------------------------------------------------------------------ failure */

interface CauseDetails {
  message: string;
  code: string | null;
  status: number | null;
  details: string | null;
  hint: string | null;
}

/**
 * A submission failure with the step that failed and the original cause intact.
 *
 * Never constructed for control flow — it is always thrown out of the flow so the
 * caller can log it (full detail) and show it (safe summary).
 */
export class SubmissionError extends Error {
  readonly step: SubmissionStep;
  readonly code: string | null;
  readonly status: number | null;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(step: SubmissionStep, cause: unknown) {
    const details = readCause(cause);
    super(details.message, { cause });
    this.name = "SubmissionError";
    this.step = step;
    this.code = details.code;
    this.status = details.status;
    this.details = details.details;
    this.hint = details.hint;
  }
}

/**
 * Read a Supabase/Postgres error out of a (possibly wrapped) cause chain.
 *
 * Services wrap errors to give them a readable message, so the SQLSTATE code
 * usually lives one or two `cause` links down. Reading the whole chain keeps that
 * code available for logging instead of losing it in the wrapping.
 */
function readCause(error: unknown): CauseDetails {
  const chain: unknown[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current !== null && current !== undefined; depth += 1) {
    chain.push(current);
    const next = (current as { cause?: unknown }).cause;
    if (next === current) break;
    current = next;
  }

  const withCode = chain.find(
    (part): part is { code: string } =>
      typeof part === "object" &&
      part !== null &&
      typeof (part as { code?: unknown }).code === "string",
  );
  const parts = chain.filter(
    (part): part is Record<string, unknown> => typeof part === "object" && part !== null,
  );
  const text = (key: string): string | null => {
    for (const part of parts) {
      const value = part[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
    return null;
  };
  const statusValue = parts
    .map((part) => part["status"])
    .find((value) => typeof value === "number");

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string" && error
        ? error
        : "The submission stopped unexpectedly.";

  return {
    message,
    code: withCode?.code ?? null,
    status: typeof statusValue === "number" ? statusValue : null,
    details: text("details"),
    hint: text("hint"),
  };
}

/**
 * Server/console log for a failed submission.
 *
 * Deliberately verbose: the step, the SQLSTATE/HTTP code, the database detail and
 * the untouched original error. This is the diagnostic trail the UI must never
 * hide behind "Submission failed".
 */
export function logSubmissionFailure(error: unknown): void {
  const failure =
    error instanceof SubmissionError ? error : new SubmissionError("create-project", error);
  console.error("[submission] failed", {
    step: failure.step,
    code: failure.code,
    status: failure.status,
    message: failure.message,
    details: failure.details,
    hint: failure.hint,
  });
  console.error("[submission] original error", failure.cause ?? failure);
}

export interface SubmissionFailureView {
  /** Safe to show to any user. */
  message: string;
  /** The real error, only outside production (never shown in the live UI). */
  diagnostic: string | null;
}

/**
 * Turn a failure into a message the candidate can act on.
 *
 * The friendly text names the class of failure (schema, policy, session, …) and
 * says whether anything was persisted. In development the raw step/code/message is
 * appended so the actual cause is visible where it is being fixed; in production
 * it stays in the console log only.
 */
export function describeSubmissionFailure(error: unknown): SubmissionFailureView {
  const failure =
    error instanceof SubmissionError ? error : new SubmissionError("create-project", error);
  const haystack = [failure.message, failure.details ?? "", failure.hint ?? ""]
    .join(" ")
    .toLowerCase();
  const code = failure.code ?? "";

  const message = (() => {
    if (haystack.includes("supabase is not configured")) {
      return "This build has no database configured, so the submission could not be stored. Nothing was created.";
    }
    if (
      code === "PGRST301" ||
      failure.status === 401 ||
      /jwt|session|not authenticated|anonymous sign-ins/.test(haystack)
    ) {
      return "Your session is no longer valid. Sign in again and resubmit — nothing was created.";
    }
    if (
      code === "42P01" ||
      code === "42703" ||
      code === "PGRST204" ||
      code === "PGRST205" ||
      /column .* does not exist|relation .* does not exist|schema cache|table .* not found/.test(
        haystack,
      )
    ) {
      return "The database is missing part of the submission schema, so nothing was saved. Apply the SQL migrations in supabase/migrations (0001 through 0010) and resubmit.";
    }
    if (code === "42501" || /row-level security|permission denied/.test(haystack)) {
      return "A database policy rejected this submission for the current account. Sign in again and resubmit — nothing was created.";
    }
    if (code === "23503" || /foreign key/.test(haystack)) {
      return "A linked record is missing (your profile or the hackathon), so nothing was created. Sign in again, then resubmit.";
    }
    if (code === "23505" || /duplicate key|already exists/.test(haystack)) {
      return "This project already has a submission. Open it from your dashboard instead of submitting a second one.";
    }
    if (/timeout|took too long|timed out/.test(haystack)) {
      return "The database did not answer in time. Check your connection and submit again.";
    }
    if (/fetch failed|network|failed to fetch/.test(haystack)) {
      return "The request to the database failed. Check your connection and submit again.";
    }
    return "The submission could not be stored, so it was not saved.";
  })();

  const diagnostic = import.meta.env.DEV
    ? [
        `step=${failure.step}`,
        failure.code ? `code=${failure.code}` : null,
        failure.status ? `status=${failure.status}` : null,
        failure.message,
        failure.details,
        failure.hint,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" · ")
    : null;

  return { message, diagnostic };
}

/* ------------------------------------------------------------------ stores */

/**
 * The database-backed store used for a signed-in candidate.
 *
 * `source` decides which workflow the created project belongs to: a candidate
 * submission (`candidate_submission`, invisible in the Projects listing) or
 * managed work (`project_manager`). A manager who typed a hackathon code is
 * acting as a candidate for that submission, so the tag follows the *workflow*,
 * never the account type.
 */
export function databaseSubmissionStore(
  userId: string,
  options: { source: "candidate_submission" | "project_manager" },
): SubmissionStore {
  return {
    kind: "database",
    async createProject(draft) {
      // A submission is written as the signed-in user; without a live session
      // every insert would be rejected by the owner-only policies. Fail here with
      // the reason instead of surfacing a policy violation later.
      const session = await getSession().catch(() => null);
      if (!session?.user) {
        throw new Error("Your session is no longer active. Sign in again and resubmit.");
      }

      const input = {
        name: draft.projectName,
        repo_url: draft.repoUrl,
        website_url: draft.websiteUrl,
        description: draft.description,
        status: "draft" as const,
      };
      const project =
        options.source === "candidate_submission"
          ? await createCandidateProject(userId, input)
          : await createProjectForUser(userId, input);

      return {
        id: project.id,
        name: project.name,
        repoUrl: project.repo_url,
        websiteUrl: project.website_url,
        description: project.description,
      };
    },
    async createReport(project, draft) {
      const report = await createReportForUser(userId, {
        type: "Project",
        name: project.name,
        project_id: project.id,
        status: "In Progress",
        report_data: draft.reportData,
      });
      return { id: report.id, createdAt: report.created_at };
    },
    async discard({ projectId, reportId }) {
      if (reportId) await deleteReport(reportId).catch(() => undefined);
      if (projectId) await deleteProject(projectId).catch(() => undefined);
    },
  };
}

/** The browser store used for guest submissions (nothing leaves this browser). */
export function guestSubmissionStore(): SubmissionStore {
  return {
    kind: "browser",
    async createProject(draft) {
      const project = createGuestProject({
        name: draft.projectName,
        repo_url: draft.repoUrl,
        website_url: draft.websiteUrl,
        description: draft.description,
      });
      return {
        id: project.id,
        name: project.name,
        repoUrl: project.repo_url,
        websiteUrl: project.website_url,
        description: project.description,
      };
    },
    async createReport(project, draft) {
      const report = createGuestReport({
        type: "Project",
        name: project.name,
        project_id: project.id,
        status: "In Progress",
        report_data: draft.reportData,
      });
      return { id: report.id, createdAt: report.created_at };
    },
    async discard({ projectId, reportId }) {
      if (reportId) deleteGuestReport(reportId);
      if (projectId) deleteGuestProject(projectId);
    },
  };
}

/* ------------------------------------------------------------------- flow */

async function step<T>(name: SubmissionStep, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw error instanceof SubmissionError ? error : new SubmissionError(name, error);
  }
}

/**
 * The submission already filed for this candidate and event, if any.
 *
 * An unassigned submission (`hackathonId = null`) counts as the same target as a
 * submission with no code: resubmitting without a code edits that row rather than
 * stacking another. A lookup failure is not fatal — it only costs us the resume,
 * and the database constraints still refuse a real duplicate.
 */
async function findExistingSubmission(draft: SubmissionDraft) {
  try {
    const rows = await listCandidateSubmissions(draft.candidateId);
    const target = draft.hackathon?.id ?? null;
    return rows.find((row) => (row.submission.hackathonId ?? null) === target)?.submission ?? null;
  } catch (error) {
    console.warn("[submission] could not check for an existing submission", error);
    return null;
  }
}

/**
 * Create (or resume) the project, report and submission for one candidate entry.
 *
 * Resolves only once every required row exists. Throws a {@link SubmissionError}
 * after removing whatever this attempt created, so a failure never leaves a
 * project without a report or a submission pointing at a missing id.
 */
export async function createProjectSubmission(
  store: SubmissionStore,
  draft: SubmissionDraft,
  options: { fileSubmission: boolean },
): Promise<SubmissionOutcome> {
  const existing = options.fileSubmission ? await findExistingSubmission(draft) : null;

  let projectId = existing?.projectId ?? null;
  let projectName = draft.projectName;
  let reportId = existing?.reportId ?? null;
  let reportCreatedAt: string | null = null;
  let submissionId: string | null = null;

  let createdProjectId: string | null = null;
  let createdReportId: string | null = null;

  try {
    if (!projectId) {
      const project = await step("create-project", () => store.createProject(draft));
      projectId = project.id;
      projectName = project.name;
      createdProjectId = project.id;
    }
    // Narrowed once, so the report/submission steps below (including the ones
    // inside closures) can only ever use a real id.
    const ownerProjectId: string = projectId;

    // The report is what the analysis pipeline and the report page read; the
    // deck/links payload only ever reaches the database through it.
    if (!reportId) {
      const project: StoredProject = {
        id: ownerProjectId,
        name: projectName,
        repoUrl: draft.repoUrl,
        websiteUrl: draft.websiteUrl,
        description: draft.description,
      };
      const report = await step("create-report", () => store.createReport(project, draft));
      reportId = report.id;
      reportCreatedAt = report.createdAt;
      createdReportId = report.id;
    }
    const ownerReportId: string = reportId;

    if (options.fileSubmission) {
      // Foreign keys now point at real rows: the submission can reference the
      // database-generated project/report ids.
      const submission = await step("create-submission", () =>
        submitToHackathon({
          hackathonId: draft.hackathon?.id ?? null,
          candidateId: draft.candidateId,
          teamName: draft.teamName,
          teamMembers: draft.teamMembers,
          description: draft.description,
          repoUrl: draft.repoUrl,
          websiteUrl: draft.websiteUrl,
          deckName: draft.deckName,
          projectId: ownerProjectId,
          reportId: ownerReportId,
        }),
      );
      submissionId = submission.id;

      // Bookkeeping on an already-stored submission: if the database refuses the
      // status write (policy/trigger), the submission still stands and the judge
      // portal still shows it. Log it, never fail the submission over it.
      await step("sync-progress", async () => {
        try {
          await syncSubmissionProgress(submission.id, draft.candidateId, { status: "processing" });
        } catch (error) {
          console.warn("[submission] progress update was not applied", {
            submissionId: submission.id,
            error,
          });
        }
      });
    }

    return {
      projectId: ownerProjectId,
      projectName,
      reportId: ownerReportId,
      reportCreatedAt: reportCreatedAt ?? new Date().toISOString(),
      submissionId,
      hackathon: draft.hackathon,
      status: submissionId ? "processing" : "submitted",
    };
  } catch (error) {
    const failure =
      error instanceof SubmissionError ? error : new SubmissionError("create-project", error);
    // Only rows created by *this* attempt are removed: resuming an existing
    // submission must never delete the candidate's earlier work.
    await store.discard({ projectId: createdProjectId, reportId: createdReportId });
    logSubmissionFailure(failure);
    throw failure;
  }
}
