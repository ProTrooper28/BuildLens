/**
 * Evaluation run store — where `pending → processing → completed|failed` lives.
 *
 * Two implementations behind one interface:
 *
 *   • MemoryEvaluationStore       — default. Survives for the life of the
 *                                   server process; zero configuration, used
 *                                   by tests and by environments without a
 *                                   service key.
 *   • SupabaseEvaluationRunStore  — used automatically when
 *                                   `SUPABASE_SERVICE_ROLE_KEY` is set. Writes
 *                                   the additive `ai_evaluation_runs` table
 *                                   (supabase/migrations/0004). The service
 *                                   role bypasses RLS; the table deliberately
 *                                   exposes no client policies, so existing
 *                                   APIs and tables are untouched.
 *
 * Selection happens in `activeEvaluationStore()`; tests pin their own store
 * with `registerEvaluationRunStore()`.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { EvidenceBundle } from "@/services/evidence/types";
import { readEnv } from "./env";
import { agentLogger, errorMessage } from "./logger";
import {
  isEvaluationRunStatus,
  type EvaluationRun,
  type EvaluationRunStatus,
  type EvaluationSubmission,
  type StructuredEvaluation,
} from "./schema";

export interface EvaluationRunPatch {
  status?: EvaluationRunStatus | undefined;
  result?: StructuredEvaluation | null | undefined;
  evidenceBundle?: EvidenceBundle | null | undefined;
  error?: string | null | undefined;
  model?: string | null | undefined;
  startedAt?: string | null | undefined;
  completedAt?: string | null | undefined;
}

export interface EvaluationRunStore {
  createRun(submission: EvaluationSubmission): Promise<EvaluationRun>;
  getRun(id: string): Promise<EvaluationRun | null>;
  updateRun(id: string, patch: EvaluationRunPatch): Promise<EvaluationRun>;
}

/** Store-level failure (persistence unavailable, table missing, …). */
export class EvaluationStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationStoreError";
  }
}

function newRunId(): string {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function now(): string {
  return new Date().toISOString();
}

/* --------------------------------------------------------------- memory -- */

export class MemoryEvaluationStore implements EvaluationRunStore {
  private readonly runs = new Map<string, EvaluationRun>();

  async createRun(submission: EvaluationSubmission): Promise<EvaluationRun> {
    const timestamp = now();
    const run: EvaluationRun = {
      id: newRunId(),
      status: "pending",
      submission,
      result: null,
      evidenceBundle: null,
      error: null,
      model: null,
      createdAt: timestamp,
      startedAt: null,
      completedAt: null,
      updatedAt: timestamp,
    };
    this.runs.set(run.id, run);
    return { ...run };
  }

  async getRun(id: string): Promise<EvaluationRun | null> {
    const run = this.runs.get(id);
    return run ? { ...run } : null;
  }

  async updateRun(id: string, patch: EvaluationRunPatch): Promise<EvaluationRun> {
    const run = this.runs.get(id);
    if (!run) throw new EvaluationStoreError(`Evaluation run ${id} does not exist`);
    if (patch.status !== undefined) run.status = patch.status;
    if (patch.result !== undefined) run.result = patch.result;
    if (patch.evidenceBundle !== undefined) run.evidenceBundle = patch.evidenceBundle;
    if (patch.error !== undefined) run.error = patch.error;
    if (patch.model !== undefined) run.model = patch.model;
    if (patch.startedAt !== undefined) run.startedAt = patch.startedAt;
    if (patch.completedAt !== undefined) run.completedAt = patch.completedAt;
    run.updatedAt = now();
    return { ...run };
  }
}

/* ------------------------------------------------------------- supabase -- */

interface AiEvaluationRunRow {
  id: string;
  submission_id: string | null;
  submission: unknown;
  status: string;
  result: unknown;
  evidence_bundle?: unknown;
  error: string | null;
  model: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRun(row: AiEvaluationRunRow): EvaluationRun {
  return {
    id: row.id,
    status: isEvaluationRunStatus(row.status) ? row.status : "failed",
    submission: row.submission as EvaluationSubmission,
    result: (row.result ?? null) as StructuredEvaluation | null,
    evidenceBundle: (row.evidence_bundle ?? null) as EvidenceBundle | null,
    error: row.error,
    model: row.model,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

const TABLE_HINT =
  "If the ai_evaluation_runs table does not exist yet, apply supabase/migrations/0004_evaluation_agent.sql.";

export class SupabaseEvaluationRunStore implements EvaluationRunStore {
  private client: SupabaseClient | null = null;

  constructor(
    private readonly config: { url: string; serviceKey: string },
  ) {}

  private supabase(): SupabaseClient {
    if (!this.client) {
      this.client = createClient(this.config.url, this.config.serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    return this.client;
  }

  async createRun(submission: EvaluationSubmission): Promise<EvaluationRun> {
    const { data, error } = await this.supabase()
      .from("ai_evaluation_runs")
      .insert({
        submission_id: submission.submissionId ?? null,
        submission,
        status: "pending",
      })
      .select()
      .single();
    if (error || !data) {
      throw new EvaluationStoreError(
        `Could not persist the evaluation run: ${error?.message ?? "no row returned"}. ${TABLE_HINT}`,
      );
    }
    return rowToRun(data as unknown as AiEvaluationRunRow);
  }

  async getRun(id: string): Promise<EvaluationRun | null> {
    const { data, error } = await this.supabase()
      .from("ai_evaluation_runs")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw new EvaluationStoreError(`Could not read the evaluation run: ${error.message}`);
    }
    return data ? rowToRun(data as unknown as AiEvaluationRunRow) : null;
  }

  async updateRun(id: string, patch: EvaluationRunPatch): Promise<EvaluationRun> {
    const row: Record<string, unknown> = { updated_at: now() };
    if (patch.status !== undefined) row["status"] = patch.status;
    if (patch.result !== undefined) row["result"] = patch.result;
    // The evidence bundle is written best-effort: a database that predates the
    // column must not fail the run, it only loses refresh-safe evidence.
    if (patch.evidenceBundle !== undefined) row["evidence_bundle"] = patch.evidenceBundle;
    if (patch.error !== undefined) row["error"] = patch.error;
    if (patch.model !== undefined) row["model"] = patch.model;
    if (patch.startedAt !== undefined) row["started_at"] = patch.startedAt;
    if (patch.completedAt !== undefined) row["completed_at"] = patch.completedAt;

    let { data, error } = await this.supabase()
      .from("ai_evaluation_runs")
      .update(row)
      .eq("id", id)
      .select()
      .single();

    // A deployment that has not applied 0006 yet has no evidence_bundle
    // column. The run itself must still succeed, so retry without it.
    if (error && "evidence_bundle" in row && /evidence_bundle/i.test(error.message)) {
      const { evidence_bundle: _dropped, ...rest } = row;
      void _dropped;
      const retry = await this.supabase()
        .from("ai_evaluation_runs")
        .update(rest)
        .eq("id", id)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error || !data) {
      throw new EvaluationStoreError(
        `Could not update the evaluation run: ${error?.message ?? "no row returned"}. ${TABLE_HINT}`,
      );
    }
    return rowToRun(data as unknown as AiEvaluationRunRow);
  }
}

/* -------------------------------------------------------------- factory -- */

function createDefaultEvaluationRunStore(): EvaluationRunStore {
  const url = readEnv("VITE_SUPABASE_URL");
  const serviceKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (url && serviceKey) {
    agentLogger.info("evaluation.store", { implementation: "supabase" });
    return new SupabaseEvaluationRunStore({ url, serviceKey });
  }
  agentLogger.info("evaluation.store", {
    implementation: "memory",
    reason: serviceKey
      ? "VITE_SUPABASE_URL missing"
      : "SUPABASE_SERVICE_ROLE_KEY not set — runs persist for the server process lifetime",
  });
  return new MemoryEvaluationStore();
}

/** undefined = auto-select; tests pin a store with an explicit instance. */
let registeredStore: EvaluationRunStore | null | undefined = undefined;
let defaultStore: EvaluationRunStore | null = null;

export function registerEvaluationRunStore(store: EvaluationRunStore | null | undefined): void {
  registeredStore = store;
}

/** The store the pipeline persists runs in. */
export function activeEvaluationStore(): EvaluationRunStore {
  if (registeredStore) return registeredStore;
  if (!defaultStore) defaultStore = createDefaultEvaluationRunStore();
  return defaultStore;
}

/** Re-select on the next use (tests; also surfaces as a log line). */
export function resetEvaluationRunStore(): void {
  registeredStore = undefined;
  defaultStore = null;
}

export { errorMessage };
