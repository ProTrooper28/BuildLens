/**
 * Evaluation agent — data schema.
 *
 * Three things live here, all validated with zod so callers and the model are
 * held to the same contract:
 *
 *   1. `EvaluationSubmission`     — what a caller sends to start an evaluation.
 *   2. `StructuredEvaluation`     — the machine-readable evaluation the model
 *                                   must return: scores per dimension,
 *                                   reasoning, evidence, strengths, weaknesses
 *                                   and red flags. Never free text.
 *   3. `EvaluationRun`            — the persisted lifecycle record
 *                                   (pending → processing → completed|failed).
 *
 * The schema is deliberately strict about *shape* and lenient about *content*:
 * a malformed model response fails validation loudly (the run is marked
 * `failed` with the reason) instead of being coerced into plausible-looking
 * numbers — a fabricated score would silently corrupt the leaderboard, exactly
 * what services/judging/ai-evaluation.service refuses to do.
 */

import { z } from "zod";

import { CLAIM_EVIDENCE_STATUSES, type EvidenceBundle } from "@/services/evidence/types";

/* ------------------------------------------------------------------ status */

export const EVALUATION_RUN_STATUSES = ["pending", "processing", "completed", "failed"] as const;

export type EvaluationRunStatus = (typeof EVALUATION_RUN_STATUSES)[number];

export function isEvaluationRunStatus(value: unknown): value is EvaluationRunStatus {
  return (
    typeof value === "string" && (EVALUATION_RUN_STATUSES as readonly string[]).includes(value)
  );
}

/* -------------------------------------------------------------- submission */

/**
 * A project submission as handed to the agent.
 *
 * Only `name` is required: guest/local submissions may be sparse, and the
 * missing parts become explicit evidence gaps rather than request errors.
 * `presentation.text` carries pre-extracted PPT/PDF content today; the
 * document-OCR service fills it automatically once that service is plugged in.
 */
export const EvaluationSubmissionSchema = z.object({
  /** Optional external id (project row, guest submission id, …). */
  submissionId: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(300),
  description: z.string().max(30000).optional().nullable(),
  problemStatement: z.string().max(30000).optional().nullable(),
  solution: z.string().max(30000).optional().nullable(),
  technologies: z.array(z.string().min(1).max(120)).max(60).optional(),
  repoUrl: z.string().max(600).optional().nullable(),
  websiteUrl: z.string().max(600).optional().nullable(),
  team: z.string().max(400).optional().nullable(),
  presentation: z
    .object({
      name: z.string().max(400).optional(),
      /** Pre-extracted slide/document text (OCR service fills this later). */
      text: z.string().max(120000).optional().nullable(),
      /**
       * Claims extracted from the submitted document (problem, solution,
       * features, technology, impact). These are the team's own assertions —
       * the model must treat them as UNVERIFIED claims to check against the
       * repository/website evidence, never as facts.
       */
      /**
       * Per-page extracted text (short previews), used to cite where a claim was
       * found in the deck ("PDF page 7"). Older reports carry no page text, in
       * which case claims simply have no page reference.
       */
      pages: z
        .array(
          z.object({
            page: z.number().int().min(1).max(500),
            text: z.string().max(2000),
          }),
        )
        .max(80)
        .optional()
        .nullable(),
      claims: z
        .object({
          summary: z.string().max(2000).optional().nullable(),
          problem: z.array(z.string().max(600)).max(12).optional(),
          solution: z.array(z.string().max(600)).max(12).optional(),
          features: z.array(z.string().max(600)).max(12).optional(),
          technology: z.array(z.string().max(120)).max(24).optional(),
          impact: z.array(z.string().max(600)).max(12).optional(),
          method: z.enum(["heuristic", "llm"]).optional(),
        })
        .optional()
        .nullable(),
    })
    .optional()
    .nullable(),
  /** Free-form caller notes (demo video transcript, extra claims, …). */
  notes: z.string().max(60000).optional().nullable(),
});

export type EvaluationSubmission = z.infer<typeof EvaluationSubmissionSchema>;

export const StartEvaluationInputSchema = z.object({
  submission: EvaluationSubmissionSchema,
});

export type StartEvaluationInput = z.infer<typeof StartEvaluationInputSchema>;

/* ------------------------------------------------------------------ result */

/**
 * The dimensions the agent scores. They mirror the platform's evaluation
 * brief: description, PPT/PDF, repository/README, deployed site, technical
 * implementation, features, and evidence integrity (claims vs. proof).
 */
export const EVALUATION_DIMENSIONS = [
  "project_description",
  "presentation",
  "repository",
  "website",
  "technical_implementation",
  "features_functionality",
  "evidence_integrity",
] as const;

export type EvaluationDimension = (typeof EVALUATION_DIMENSIONS)[number];

export const DimensionScoreSchema = z.object({
  dimension: z.enum(EVALUATION_DIMENSIONS),
  /** 0–100. */
  score: z.number().min(0).max(100),
  reasoning: z.string().min(1).max(4000),
});
export type DimensionScore = z.infer<typeof DimensionScoreSchema>;

/** Where an evidence item came from. `none` = could not be verified anywhere. */
export const EVIDENCE_SOURCES = [
  "description",
  "presentation",
  "repository",
  "website",
  "manual",
  "none",
] as const;

export const EvidenceItemSchema = z.object({
  claim: z.string().min(1).max(2000),
  source: z.enum(EVIDENCE_SOURCES),
  /** Verbatim supporting snippet, when the source text actually contains it. */
  quote: z.string().max(4000).optional().nullable(),
  /** True only when provided source text supports the claim. */
  verified: z.boolean(),
  /** Gap/justification note — e.g. which ingestion service is missing. */
  note: z.string().max(2000).optional().nullable(),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const RedFlagSchema = z.object({
  label: z.string().min(1).max(300),
  severity: z.enum(["low", "medium", "high"]),
  detail: z.string().min(1).max(4000),
});
export type RedFlag = z.infer<typeof RedFlagSchema>;

/**
 * The model's answer for ONE claim from the evidence bundle.
 *
 * Deliberately the same four statuses the deterministic comparison uses, so the
 * UI, the judge and the model cannot drift apart on what "unverified" means.
 */
export const ClaimCheckResultSchema = z.object({
  /** The bundle's claim id (`deck.problem.0`, `submission.technology.1`, …). */
  id: z.string().min(1).max(120),
  status: z.enum(CLAIM_EVIDENCE_STATUSES),
  /** Why — must reference the evidence (or its absence), not the claim itself. */
  explanation: z.string().min(1).max(1200),
});
export type ClaimCheckResult = z.infer<typeof ClaimCheckResultSchema>;

/**
 * The concise final evaluation summary.
 *
 * Separate fields (not one blob) because each answers a different judge
 * question: what is this project, what backs it, what is missing, how good is
 * the engineering, and what is the verdict.
 */
export const FinalSummarySchema = z.object({
  /** What the project is and does, in the team's own terms. */
  projectUnderstanding: z.string().min(1).max(4000),
  /** Concrete, evidence-backed strengths (quote what was actually read). */
  strongestEvidence: z.array(z.string().min(1).max(1200)).max(8),
  /** Missing or contradictory evidence — including sources that could not be read. */
  majorGaps: z.array(z.string().min(1).max(1200)).max(8),
  /** Engineering depth/correctness as far as the materials show. */
  technicalAssessment: z.string().min(1).max(4000),
  /** The overall AI verdict, in one short paragraph. */
  verdict: z.string().min(1).max(2000),
});
export type FinalSummary = z.infer<typeof FinalSummarySchema>;

/** The model's raw evaluation payload, before the envelope is attached. */
export const StructuredEvaluationContentSchema = z
  .object({
    summary: z.string().min(1).max(8000),
    overallScore: z.number().min(0).max(100),
    /** Exactly one score per dimension — enforced below. */
    scores: z.array(DimensionScoreSchema),
    reasoning: z.string().min(1).max(20000),
    evidence: z.array(EvidenceItemSchema),
    strengths: z.array(z.string().min(1).max(2000)),
    weaknesses: z.array(z.string().min(1).max(2000)),
    redFlags: z.array(RedFlagSchema),
    /** One entry per claim in the evidence bundle (checked below). */
    claimChecks: z.array(ClaimCheckResultSchema),
    /** Structured closing summary the judge reads first. */
    finalSummary: FinalSummarySchema,
    /** Model self-confidence, 0–1. */
    confidence: z.number().min(0).max(1).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const entry of value.scores) {
      if (seen.has(entry.dimension)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scores"],
          message: `duplicate score for dimension "${entry.dimension}"`,
        });
      }
      seen.add(entry.dimension);
    }
    for (const dimension of EVALUATION_DIMENSIONS) {
      if (!seen.has(dimension)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scores"],
          message: `missing score for dimension "${dimension}"`,
        });
      }
    }

    const claimIds = new Set<string>();
    for (const check of value.claimChecks) {
      if (claimIds.has(check.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["claimChecks"],
          message: `duplicate claim check for "${check.id}"`,
        });
      }
      claimIds.add(check.id);
    }
  });

export type StructuredEvaluationContent = z.infer<typeof StructuredEvaluationContentSchema>;

/** What the agent persists and returns: content + provenance envelope. */
export interface StructuredEvaluation extends StructuredEvaluationContent {
  schemaVersion: "1.0";
  /** Model id that produced it (null when a custom provider omits it). */
  model: string | null;
  evaluatedAt: string;
  /**
   * Exactly what evidence the conclusion rests on: every source (readable or
   * not), every claim with its status, and the gaps. Persisted with the result
   * so a refresh — or a different judge — can audit the verdict without
   * re-running anything.
   */
  evidenceBundle: EvidenceBundle;
}

/* --------------------------------------------------------------------- run */

export interface EvaluationRun {
  id: string;
  status: EvaluationRunStatus;
  submission: EvaluationSubmission;
  /** Final structured evaluation — only when `status === "completed"`. */
  result: StructuredEvaluation | null;
  /**
   * Evidence collected for this run. Persisted as soon as the sources have been
   * read, so the judge can still inspect what was verified when the model stage
   * fails or no model is configured. Null while collection has not finished.
   */
  evidenceBundle?: EvidenceBundle | null;
  /** Failure reason — only when `status === "failed"`. */
  error: string | null;
  model: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

/* ----------------------------------------------------------------- errors */

/** Input to `startEvaluation` failed validation → HTTP 400. */
export class EvaluationValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid evaluation input: ${issues.join("; ")}`);
    this.name = "EvaluationValidationError";
    this.issues = issues;
  }
}

/** A model response could not be parsed into the schema → run `failed`. */
export class EvaluationSchemaError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[] = []) {
    super(issues.length > 0 ? `${message}: ${issues.join("; ")}` : message);
    this.name = "EvaluationSchemaError";
    this.issues = issues;
  }
}

/* ---------------------------------------------------------------- parsing */

/** Pull the first JSON object out of a possibly noisy model response. */
function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    // Models sometimes wrap JSON in a sentence — fall back to the outermost
    // braces before giving up.
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        /* fall through to the typed error below */
      }
    }
  }
  throw new EvaluationSchemaError("The model response was not a valid JSON object");
}

/**
 * Parse and validate a raw model response into evaluation content.
 *
 * Throws `EvaluationSchemaError` (with per-field reasons) instead of returning
 * a partial or coerced result — the caller marks the run `failed`.
 */
export function parseStructuredEvaluation(raw: string): StructuredEvaluationContent {
  const parsed = StructuredEvaluationContentSchema.safeParse(extractJsonObject(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new EvaluationSchemaError("Model response failed schema validation", issues);
  }
  return parsed.data;
}

/** Validate a caller payload; throws `EvaluationValidationError` with details. */
export function parseStartEvaluationInput(input: unknown): StartEvaluationInput {
  const parsed = StartEvaluationInputSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new EvaluationValidationError(issues);
  }
  return parsed.data;
}
