/**
 * Evaluation agent — pipeline.
 *
 * `startEvaluation()` is the clean service entry point: it validates the
 * submission, persists a run as `pending`, kicks the pipeline off and returns
 * immediately. The pipeline then walks the run through
 *
 *   pending → processing → completed | failed
 *
 * with a structured log line for every transition. The final value is always
 * structured JSON (`StructuredEvaluation`) — never free-text model output —
 * and a failure is recorded *on the run* (`error`, status `failed`) rather
 * than thrown at the caller, so a client only ever needs to poll the status.
 *
 * Stages (each replaceable, see module docs):
 *   1. evidence   — every registered ingestion service (document OCR, web,
 *                   GitHub are separate services; missing ones become gaps)
 *   2. model      — the registered/env LLM provider (model.ts)
 *   3. validation — zod schema check of the raw model response (schema.ts)
 *   4. persistence— the run store (store.ts)
 *
 * The prompt includes the ingestion outcomes explicitly, which is what makes
 * "evidence vs. unsupported claims" enforceable: a source with status
 * `pending`/`failed` cannot verify anything.
 */

import { collectEvidence } from "@/services/ingestion";
import type { IngestionOutcome } from "@/services/ingestion/types";
import { buildEvidenceBundle } from "@/services/evidence";
import type { ClaimEvidenceStatus, EvidenceBundle } from "@/services/evidence/types";
import {
  activeEvaluationModel,
  EvaluationModelUnavailableError,
  type EvaluationModelProvider,
} from "./model";
import { agentLogger, errorMessage } from "./logger";
import { activeEvaluationStore, type EvaluationRunStore } from "./store";
import {
  parseStartEvaluationInput,
  parseStructuredEvaluation,
  type ClaimCheckResult,
  type EvaluationRun,
  type StartEvaluationInput,
  type StructuredEvaluation,
} from "./schema";

/* ----------------------------------------------------------------- prompt */

const DIMENSION_GUIDE: Record<string, string> = {
  project_description:
    "Problem clarity, audience, scope and how well the description sells the idea on its own terms.",
  presentation:
    "Quality of the PPT/PDF narrative: structure, visuals, demo walkthrough. Score low and say so when no readable presentation content was provided.",
  repository:
    "GitHub/README quality, structure and signals of real engineering work. Score low when the repository was not readable (not provided or ingestion not connected).",
  website:
    "The deployed site: availability, polish, coherence with the claims. Score low when the site could not be inspected.",
  technical_implementation:
    "Depth and correctness of the technical build as evidenced by the submission materials.",
  features_functionality: "Breadth/depth of implemented features versus what is claimed.",
  evidence_integrity:
    "How much is actually backed by provided evidence versus asserted. Unverifiable material should lower this score.",
};

const SYSTEM_PROMPT = `You are the BuildLens evaluation agent, a rigorous technical judge for hackathon project submissions.

You receive a submission plus the outcome of every evidence ingestion service (what was actually read, and what is missing). Return ONLY a single JSON object — no markdown fences, no commentary — with exactly this shape:

{
  "summary": string,                       // 2-4 sentence verdict
  "overallScore": number,                  // 0-100
  "scores": [                              // EXACTLY ONE entry per dimension:
    { "dimension": "...", "score": number, "reasoning": string }
  ],
  "reasoning": string,                     // overall technical reasoning
  "evidence": [
    { "claim": string,
      "source": "description" | "presentation" | "repository" | "website" | "manual" | "none",
      "quote": string | null,              // verbatim supporting snippet if any
      "verified": boolean,
      "note": string | null }
  ],
  "claimChecks": [                        // EXACTLY ONE entry per claim id in evidenceBundle.claims
    { "id": string,
      "status": "supported" | "partially_supported" | "not_found" | "could_not_verify",
      "explanation": string }
  ],
  "finalSummary": {
    "projectUnderstanding": string,        // what the project is and does
    "strongestEvidence": string[],         // concrete, quoted where possible
    "majorGaps": string[],                 // missing/inconsistent evidence
    "technicalAssessment": string,
    "verdict": string                      // the overall AI verdict
  },
  "strengths": string[],
  "weaknesses": string[],
  "redFlags": [
    { "label": string, "severity": "low" | "medium" | "high", "detail": string }
  ],
  "confidence": number                     // 0-1
}

Valid dimensions (score every one): ${Object.keys(DIMENSION_GUIDE).join(", ")}

Rules:
- Separate claims from evidence. The payload has "whatTheTeamClaims" (submitted form text, declared technologies, and the deck's extracted claims) and "whatTheEvidenceShows" (facts read from the repository and the deployed site, plus which sources could not be read). Describe the first as claims and the second as findings — never blur them.
- Evidence discipline: mark verified=true ONLY when text in the provided sources supports the claim. A source whose status is "pending" or "failed" verified nothing — claims that depend on it get verified=false with a note naming the gap.
- submission.presentation.claims are CLAIMS FROM THE SUBMITTED DOCUMENT: the team's own assertions (problem, solution, features, technology, impact), extracted automatically from their deck. Treat every one as a hypothesis to verify against the repository and website evidence — never as a fact. When the evidence sources cannot confirm a claim (or are pending/failed), mark it verified=false and say which evidence is missing. Contradictions between claims and evidence belong in redFlags.
- evidenceBundle.claims each carry a deterministic status computed from the sources that were actually read. Confirm or refine them in "claimChecks", one per claim id, but NEVER turn "could_not_verify" into a negative finding and never describe a claim as false without evidence that contradicts it.
- Distinguish "not verified" from "false". Unreadable or missing sources must not lower a score on their own: score what the evidence supports and state the gap. Reserve low scores for claims the readable evidence contradicts or for missing artifacts that are the team's responsibility (no repository/deck at all).
- fill finalSummary from the evidence, not from the deck's marketing copy: projectUnderstanding may restate the team's framing, strongestEvidence must quote real source content, majorGaps must name the missing/unreadable source, and verdict must state what the evidence actually earns.
- The redFlags array is for contradictions, unverifiable headline claims, missing critical artifacts (no repo, no demo, no readable deck) and anything a reviewer must double-check.
- Score honestly on a 0-100 scale; never inflate to be polite. ${Object.entries(DIMENSION_GUIDE)
  .map(([dimension, guide]) => `\n[${dimension}] ${guide}`)
  .join("")}
- Respond with the JSON object only.`;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… [truncated]` : text;
}

function buildUserPrompt(
  input: StartEvaluationInput,
  outcomes: IngestionOutcome[],
  bundle: EvidenceBundle,
): string {
  const submission = input.submission;
  const payload = {
    submission: {
      name: submission.name,
      description: submission.description ? clip(submission.description, 6000) : null,
      problemStatement: submission.problemStatement
        ? clip(submission.problemStatement, 6000)
        : null,
      solution: submission.solution ? clip(submission.solution, 6000) : null,
      technologies: submission.technologies ?? [],
      repoUrl: submission.repoUrl ?? null,
      websiteUrl: submission.websiteUrl ?? null,
      team: submission.team ?? null,
      presentation: submission.presentation
        ? {
            name: submission.presentation.name ?? null,
            text: submission.presentation.text ? clip(submission.presentation.text, 24000) : null,
            claims: submission.presentation.claims
              ? {
                  summary: submission.presentation.claims.summary
                    ? clip(submission.presentation.claims.summary, 1200)
                    : null,
                  problem: (submission.presentation.claims.problem ?? []).map((item) =>
                    clip(item, 400),
                  ),
                  solution: (submission.presentation.claims.solution ?? []).map((item) =>
                    clip(item, 400),
                  ),
                  features: (submission.presentation.claims.features ?? []).map((item) =>
                    clip(item, 400),
                  ),
                  technology: (submission.presentation.claims.technology ?? []).map((item) =>
                    clip(item, 120),
                  ),
                  impact: (submission.presentation.claims.impact ?? []).map((item) =>
                    clip(item, 400),
                  ),
                  method: submission.presentation.claims.method ?? null,
                }
              : null,
          }
        : null,
      notes: submission.notes ? clip(submission.notes, 6000) : null,
    },
    whatTheTeamClaims: {
      description: submission.description ? clip(submission.description, 4000) : null,
      problemStatement: submission.problemStatement
        ? clip(submission.problemStatement, 4000)
        : null,
      solution: submission.solution ? clip(submission.solution, 4000) : null,
      technologies: submission.technologies ?? [],
      deckClaims: submission.presentation?.claims ?? null,
      claims: bundle.claims.map((claim) => ({
        id: claim.id,
        category: claim.category,
        claim: claim.claim,
        deterministicStatus: claim.status,
        note: claim.note,
      })),
    },
    whatTheEvidenceShows: {
      sources: bundle.sources.map((source) => ({
        kind: source.kind,
        status: source.status,
        readable: source.readable,
        url: source.url,
        detail: source.detail,
        facts: source.highlights,
        // Structured checks (with the exact URL/header/file path behind them).
        // They are observations, so the model should reason from them rather
        // than repeating a README.
        observations: (source.observations ?? []).map((entry) => ({
          area: entry.area,
          check: entry.label,
          status: entry.status,
          result: entry.result,
          evidence: entry.evidence,
        })),
      })),
      gaps: bundle.gaps,
      evidenceSources: outcomes.map((outcome) => ({
        kind: outcome.kind,
        status: outcome.status,
        detail: outcome.detail,
        text: outcome.text ? clip(outcome.text, 12000) : null,
      })),
    },
  };
  return `Evaluate this submission.\n\n${JSON.stringify(payload, null, 2)}`;
}

/**
 * Merge the model's claim checks with the deterministic ones.
 *
 * The deterministic status is the floor: if the model omits a claim (or returns
 * an id that does not exist) the stored evaluation still answers every claim,
 * so the Evidence section is never partially empty.
 */
export function mergeClaimChecks(
  bundle: EvidenceBundle,
  fromModel: readonly ClaimCheckResult[],
): ClaimCheckResult[] {
  const byId = new Map(fromModel.map((check) => [check.id, check]));
  return bundle.claims.map((claim) => {
    const modelCheck = byId.get(claim.id);
    if (modelCheck) {
      return {
        id: claim.id,
        status: modelCheck.status as ClaimEvidenceStatus,
        explanation: modelCheck.explanation,
      };
    }
    return { id: claim.id, status: claim.status, explanation: claim.note };
  });
}

/* --------------------------------------------------------------- pipeline */

const inflight = new Map<string, Promise<void>>();

/** Execute (or re-execute) one run to a terminal status. Exported for tests. */
export async function executeRun(runId: string): Promise<void> {
  const store = activeEvaluationStore();
  const started = Date.now();

  let run: EvaluationRun | null = null;
  try {
    run = await store.getRun(runId);
    if (!run) throw new Error(`Evaluation run ${runId} does not exist`);
    await store.updateRun(runId, {
      status: "processing",
      startedAt: new Date().toISOString(),
      error: null,
    });
    agentLogger.info("evaluation.processing", { runId });

    // Evidence is collected before the model is required. The inspection is a
    // deterministic read of public sources, so it must reach the judge even when
    // no AI provider is configured — that run is partial, not empty.
    const outcomes = await collectEvidence(run.submission);
    const gaps = outcomes.filter((outcome) => outcome.status !== "ingested");
    // Deterministic claim → evidence comparison, computed before the model runs
    // so the prompt contains both sides and the result is auditable.
    const bundle = buildEvidenceBundle(run.submission, outcomes);
    // Persist the bundle before the model runs: if the model is unavailable or
    // errors, the judge can still inspect exactly what was verified.
    try {
      await store.updateRun(runId, { evidenceBundle: bundle });
    } catch (error) {
      agentLogger.warn("evaluation.evidence_persist_failed", {
        runId,
        error: errorMessage(error),
      });
    }
    agentLogger.info("evaluation.evidence", {
      runId,
      ingested: outcomes.length - gaps.length,
      gaps: gaps.map((gap) => gap.kind),
      claims: bundle.claims.length,
      supported: bundle.counts.supported,
      couldNotVerify: bundle.counts.could_not_verify,
    });

    const model = activeEvaluationModel();
    if (!model || !model.isAvailable()) {
      throw new EvaluationModelUnavailableError();
    }

    const raw = await model.request({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt({ submission: run.submission }, outcomes, bundle),
    });

    const content = parseStructuredEvaluation(raw);
    const result: StructuredEvaluation = {
      ...content,
      claimChecks: mergeClaimChecks(bundle, content.claimChecks),
      evidenceBundle: bundle,
      schemaVersion: "1.0",
      model: model.model ?? model.id,
      evaluatedAt: new Date().toISOString(),
    };

    await store.updateRun(runId, {
      status: "completed",
      result,
      error: null,
      model: result.model,
      completedAt: new Date().toISOString(),
    });
    agentLogger.info("evaluation.completed", {
      runId,
      model: result.model,
      overallScore: result.overallScore,
      redFlags: result.redFlags.length,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    const message = errorMessage(error);
    agentLogger.error("evaluation.failed", {
      runId,
      error: message,
      durationMs: Date.now() - started,
    });
    try {
      await store.updateRun(runId, {
        status: "failed",
        error: message,
        completedAt: new Date().toISOString(),
      });
    } catch (storeError) {
      // The run cannot even record its failure — log loudly; the status will
      // remain non-terminal, but nothing silently disappears.
      agentLogger.error("evaluation.failed_persist_failed", {
        runId,
        error: errorMessage(storeError),
      });
      throw storeError;
    }
  }
}

/**
 * Start an evaluation for a submission.
 *
 * Validates the payload (throws `EvaluationValidationError` → HTTP 400),
 * persists the run as `pending`, schedules the pipeline and returns the run
 * without waiting for the model.
 */
export async function startEvaluation(input: unknown): Promise<EvaluationRun> {
  const parsed = parseStartEvaluationInput(input);
  const store = activeEvaluationStore();
  const run = await store.createRun(parsed.submission);
  agentLogger.info("evaluation.started", {
    runId: run.id,
    submission: parsed.submission.name,
  });

  const task = executeRun(run.id).catch((error: unknown) => {
    // executeRun records failures itself; this only guards against an
    // unexpected rejection so the in-flight promise never goes unhandled.
    agentLogger.error("evaluation.execute_crashed", {
      runId: run.id,
      error: errorMessage(error),
    });
  });
  inflight.set(run.id, task);
  void task.finally(() => inflight.delete(run.id));

  return run;
}

/**
 * Read a run's status/result.
 *
 * `wait: true` awaits an in-flight pipeline first, which makes polling
 * deterministic for API clients and tests (one request → terminal status).
 */
export async function getEvaluationRun(
  id: string,
  options?: { wait?: boolean | undefined },
): Promise<EvaluationRun | null> {
  if (options?.wait) {
    const task = inflight.get(id);
    if (task) await task;
  }
  return activeEvaluationStore().getRun(id);
}

/** Test/reset helper: clear tracked in-flight runs. */
export function resetEvaluationAgent(): void {
  inflight.clear();
}

export type { EvaluationModelProvider };
