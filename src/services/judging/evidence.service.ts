/**
 * Judge-facing evidence client.
 *
 * Starts and reads AI evidence runs through the existing evaluation endpoints
 * (`POST /api/evaluations`, `GET /api/evaluations/{id}`) — no second pipeline,
 * no new scoring path. The run id is stored per submission in this browser so a
 * refresh re-attaches to the same run instead of spending another model call;
 * the run itself is persisted server-side by the agent's store (memory in
 * development, Postgres when the service role is configured).
 */

import type { EvaluationRun, EvaluationSubmission } from "@/services/evaluation-agent/schema";
import type { ProjectDetail, SubmissionDetail } from "@/types/evaluation";

export class EvidenceRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "EvidenceRequestError";
    this.status = status;
  }
}

const STORAGE_PREFIX = "buildlens:evidence-run:";

export function evidenceStorageKey(submissionId: string): string {
  return `${STORAGE_PREFIX}${submissionId}`;
}

/** The run id this browser last used for the submission (refresh-safe resume). */
export function readStoredRunId(submissionId: string): string | null {
  try {
    return window.localStorage.getItem(evidenceStorageKey(submissionId));
  } catch {
    return null;
  }
}

export function storeRunId(submissionId: string, runId: string): void {
  try {
    window.localStorage.setItem(evidenceStorageKey(submissionId), runId);
  } catch {
    // Private mode / storage full: the run still exists server-side; the judge
    // just loses the automatic resume and can re-run it deliberately.
  }
}

export function clearStoredRunId(submissionId: string): void {
  try {
    window.localStorage.removeItem(evidenceStorageKey(submissionId));
  } catch {
    /* ignore */
  }
}

/** Map a judging submission onto the agent's input contract. */
export function submissionForEvidence(detail: SubmissionDetail): EvaluationSubmission {
  if (detail.category === "resume") {
    return {
      submissionId: detail.id,
      name: detail.name,
      description: detail.summary ?? detail.headline ?? null,
      technologies: detail.skills,
      repoUrl: null,
      websiteUrl: null,
      team: null,
      presentation: detail.resumeDocument ? { name: detail.resumeDocument.name, text: null } : null,
      notes: null,
    };
  }

  const project: ProjectDetail = detail;
  const claims = project.presentationClaims ?? null;
  return {
    submissionId: project.id,
    name: project.name,
    description: project.description ?? null,
    problemStatement: project.problemStatement ?? null,
    solution: project.solution ?? null,
    technologies: project.technologies,
    repoUrl: project.repoUrl,
    websiteUrl: project.demoUrl,
    team: project.team,
    presentation:
      claims || (project.presentationPages?.length ?? 0) > 0
        ? {
            name: project.media.find((item) => item.kind === "document")?.label ?? "Presentation",
            text: null,
            ...(claims ? { claims } : {}),
            // Short page previews so claims can cite "page 7" when the report
            // stored per-page text.
            ...(project.presentationPages?.length ? { pages: project.presentationPages } : {}),
          }
        : null,
    notes: null,
  };
}

function parseRunResponse(body: unknown): EvaluationRun {
  const run = (body as { run?: unknown } | null)?.run;
  if (!run || typeof run !== "object" || !("id" in run) || !("status" in run)) {
    throw new EvidenceRequestError("The evaluation service returned an unexpected response.", 502);
  }
  return run as EvaluationRun;
}

function errorMessageOf(body: unknown, fallback: string): string {
  const message = (body as { error?: unknown } | null)?.error;
  return typeof message === "string" && message.trim() ? message : fallback;
}

/** Start (or re-start) an evidence evaluation for one submission. */
export async function startEvidenceRun(detail: SubmissionDetail): Promise<EvaluationRun> {
  let response: Response;
  try {
    response = await fetch("/api/evaluations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submission: submissionForEvidence(detail) }),
    });
  } catch {
    throw new EvidenceRequestError(
      "The evidence service could not be reached. Check your connection and try again.",
      0,
    );
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new EvidenceRequestError(
      response.status === 401
        ? "This deployment protects the evaluation endpoint with a server token, so evidence checks cannot be started from the browser."
        : errorMessageOf(body, `The evidence run could not be started (HTTP ${response.status}).`),
      response.status,
    );
  }
  return parseRunResponse(body);
}

/** Read one run; `wait` lets a single call return the terminal result. */
export async function fetchEvidenceRun(runId: string, wait = false): Promise<EvaluationRun> {
  let response: Response;
  try {
    response = await fetch(
      `/api/evaluations/${encodeURIComponent(runId)}${wait ? "?wait=true" : ""}`,
    );
  } catch {
    throw new EvidenceRequestError("The evidence service could not be reached.", 0);
  }

  const body = await response.json().catch(() => null);
  if (response.status === 404) {
    throw new EvidenceRequestError(
      "This evidence run is no longer stored on the server (it may have expired). Run the check again.",
      404,
    );
  }
  if (!response.ok) {
    throw new EvidenceRequestError(
      errorMessageOf(body, `The evidence run could not be read (HTTP ${response.status}).`),
      response.status,
    );
  }
  return parseRunResponse(body);
}

/** True while the run is still moving through the pipeline. */
export function isRunInFlight(run: EvaluationRun | null): boolean {
  return run?.status === "pending" || run?.status === "processing";
}
