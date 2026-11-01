import type { Json } from "@/types/database";
import type {
  CriteriaSet,
  CriterionScore,
  EvaluationCategory,
  EvaluationRecommendation,
  EvaluationRecordStatus,
  JudgeEvaluation,
  JudgeNote,
} from "@/types/evaluation";
import { getSupabase } from "@/lib/supabase";
import { advanceSubmissionStatus } from "@/services/hackathon.service";
import { canUseRemote, localId, readJournal, runJudging, writeJournal } from "./store";

/**
 * Judge evaluations — read, draft, submit.
 *
 * A submission can carry any number of evaluations (one per judge), which is what
 * makes averages, score distributions and "number of evaluations" possible. The
 * current judge only ever writes their own row; the database enforces that with
 * RLS (`judge_id = auth.uid()`), and the local journal has a single judge by
 * construction.
 *
 * Notes travel with the evaluation but are stored separately from the numeric
 * scores (and, in the database, in their own RLS-protected table), so no read of
 * the cohort's scores can leak another judge's private notes.
 */

export interface EvaluationDraftInput {
  submissionId: string;
  category: EvaluationCategory;
  judgeId: string;
  judgeName: string | null;
  scores: CriterionScore[];
  recommendation: EvaluationRecommendation;
  note: { body: string; visibility: "private" | "feedback" } | null;
  /** Rubric the judge scored against; snapshotted so edits can't rewrite it. */
  criteria: CriteriaSet;
  /** `in_progress` = saved draft, `evaluated` = submitted. */
  status: Exclude<EvaluationRecordStatus, "reviewed">;
}

/* ----------------------------------------------------------------- mapping */

interface EvaluationRow {
  id: string;
  submission_id: string;
  submission_category: EvaluationCategory;
  judge_id: string;
  judge_name: string | null;
  status: EvaluationRecordStatus;
  recommendation: EvaluationRecommendation;
  scores: unknown;
  criteria_snapshot: unknown;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
}

interface NoteRow {
  evaluation_id: string;
  body: string;
  visibility: "private" | "feedback";
  updated_at: string;
}

function toScores(value: unknown): CriterionScore[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const awarded = item["awarded"];
      return {
        criterionId: typeof item["criterionId"] === "string" ? item["criterionId"] : "",
        awarded: typeof awarded === "number" && Number.isFinite(awarded) ? awarded : null,
        note: typeof item["note"] === "string" ? item["note"] : null,
      };
    })
    .filter((score) => score.criterionId !== "");
}

function toSnapshot(value: unknown): JudgeEvaluation["criteriaSnapshot"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record["criteria"])) return null;
  const maxScore = typeof record["maxScore"] === "number" ? record["maxScore"] : 0;
  const criteria = record["criteria"]
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: String(item["id"] ?? ""),
      name: String(item["name"] ?? ""),
      description: typeof item["description"] === "string" ? item["description"] : "",
      maxPoints: typeof item["maxPoints"] === "number" ? item["maxPoints"] : 0,
      weight: typeof item["weight"] === "number" ? item["weight"] : 1,
    }))
    .filter((criterion) => criterion.id !== "");
  if (criteria.length === 0) return null;
  return { maxScore, criteria };
}

function toRecord(row: EvaluationRow, note: JudgeNote | null): JudgeEvaluation {
  return {
    id: row.id,
    submissionId: row.submission_id,
    category: row.submission_category,
    judgeId: row.judge_id,
    judgeName: row.judge_name,
    status: row.status,
    scores: toScores(row.scores),
    notes: note,
    recommendation: row.recommendation ?? null,
    criteriaSnapshot: toSnapshot(row.criteria_snapshot),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
  };
}

/* -------------------------------------------------------------------- read */

/** Every evaluation recorded for a category — used for averages and ranking. */
export async function listEvaluations(
  category: EvaluationCategory,
  judgeId: string | null | undefined,
): Promise<JudgeEvaluation[]> {
  const local = (): JudgeEvaluation[] => readLocal(category);

  return runJudging(
    canUseRemote(judgeId),
    async () => {
      const supabase = getSupabase();
      const evaluations = await supabase
        .from("judge_evaluations")
        .select(
          "id, submission_id, submission_category, judge_id, judge_name, status, recommendation, scores, criteria_snapshot, created_at, updated_at, submitted_at",
        )
        .eq("submission_category", category);
      if (evaluations.error) throw evaluations.error;

      const rows = (evaluations.data ?? []) as EvaluationRow[];
      const notes = new Map<string, JudgeNote>();
      // RLS returns only the current judge's notes, even when the cohort's
      // evaluations are readable — this query can never widen that.
      const noteRows = await supabase
        .from("judge_evaluation_notes")
        .select("evaluation_id, body, visibility, updated_at");
      if (!noteRows.error) {
        for (const note of (noteRows.data ?? []) as NoteRow[]) {
          notes.set(note.evaluation_id, {
            body: note.body,
            visibility: note.visibility,
            updatedAt: note.updated_at,
          });
        }
      }

      return rows.map((row) => toRecord(row, notes.get(row.id) ?? null));
    },
    local,
  );
}

function readLocal(category: EvaluationCategory): JudgeEvaluation[] {
  const raw = readJournal().evaluations;
  return raw
    .filter((item): item is JudgeEvaluation => Boolean(item) && typeof item === "object")
    .map((item) => ({
      ...item,
      scores: toScores(item.scores),
      criteriaSnapshot: toSnapshot(item.criteriaSnapshot),
    }))
    .filter((item) => item.category === category);
}

/* ------------------------------------------------------------------- write */

/**
 * Create or update this judge's evaluation.
 *
 * The row is matched on (submission, category, judge) rather than replaced, so
 * repeated saves update one row: the page never remounts, and "Next submission"
 * reuses the cache entry instead of refetching the list.
 */
export async function saveEvaluation(input: EvaluationDraftInput): Promise<JudgeEvaluation> {
  const now = new Date().toISOString();
  const snapshot = { maxScore: input.criteria.maxScore, criteria: input.criteria.criteria };

  const local = (): JudgeEvaluation => {
    const journal = readJournal();
    const records = journal.evaluations as unknown as JudgeEvaluation[];
    const index = records.findIndex(
      (record) =>
        record.submissionId === input.submissionId &&
        record.category === input.category &&
        record.judgeId === input.judgeId,
    );
    const previous = index >= 0 ? records[index] : null;
    const record: JudgeEvaluation = {
      id: previous?.id ?? localId("eval"),
      submissionId: input.submissionId,
      category: input.category,
      judgeId: input.judgeId,
      judgeName: input.judgeName,
      status: input.status,
      scores: input.scores,
      notes:
        input.note && input.note.body.trim()
          ? {
              body: input.note.body,
              visibility: input.note.visibility,
              updatedAt: now,
            }
          : null,
      recommendation: input.recommendation,
      criteriaSnapshot: snapshot,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      submittedAt: input.status === "evaluated" ? (previous?.submittedAt ?? now) : null,
    };
    if (index >= 0) records[index] = record;
    else records.push(record);
    journal.evaluations = records;
    writeJournal(journal);
    return record;
  };

  const record = await runJudging(
    canUseRemote(input.judgeId),
    async () => {
      const supabase = getSupabase();
      const existing = await supabase
        .from("judge_evaluations")
        .select("id, created_at")
        .eq("submission_id", input.submissionId)
        .eq("submission_category", input.category)
        .eq("judge_id", input.judgeId)
        .maybeSingle();
      if (existing.error) throw existing.error;

      const payload = {
        submission_id: input.submissionId,
        submission_category: input.category,
        judge_id: input.judgeId,
        judge_name: input.judgeName,
        status: input.status,
        recommendation: input.recommendation,
        scores: input.scores as unknown as Json,
        criteria_snapshot: snapshot as unknown as Json,
        updated_at: now,
        submitted_at: input.status === "evaluated" ? now : null,
      };

      const written = existing.data?.id
        ? await supabase
            .from("judge_evaluations")
            .update(payload)
            .eq("id", existing.data.id)
            .select("*")
            .maybeSingle()
        : await supabase.from("judge_evaluations").insert(payload).select("*").maybeSingle();
      if (written.error) throw written.error;
      if (!written.data) throw new Error("Evaluation could not be saved.");

      const row = written.data as unknown as EvaluationRow;

      let note: JudgeNote | null = null;
      if (input.note && input.note.body.trim()) {
        const notePayload = {
          evaluation_id: row.id,
          judge_id: input.judgeId,
          body: input.note.body,
          visibility: input.note.visibility,
          updated_at: now,
        };
        const noteWrite = await supabase
          .from("judge_evaluation_notes")
          .upsert(notePayload, { onConflict: "evaluation_id" })
          .select("body, visibility, updated_at")
          .maybeSingle();
        if (noteWrite.error) throw noteWrite.error;
        note = input.note.body
          ? {
              body: input.note.body,
              visibility: input.note.visibility,
              updatedAt: noteWrite.data?.updated_at ?? now,
            }
          : null;
      } else {
        // Clearing the note must clear the stored row too.
        const cleared = await supabase
          .from("judge_evaluation_notes")
          .delete()
          .eq("evaluation_id", row.id);
        if (cleared.error) throw cleared.error;
      }

      return toRecord({ ...row, updated_at: now }, note);
    },
    local,
  );

  await syncSubmissionLifecycle(input);
  return record;
}

/**
 * Keep the shared submission lifecycle in step with the judge's work.
 *
 * Draft → `under_review`, submitted → `evaluated`, so the candidate's status page
 * follows along without the judge doing anything extra. The status never rewinds
 * (`advanceSubmissionStatus` is forward-only), and a failure here must not undo a
 * saved score — the evaluation is the record that matters.
 */
async function syncSubmissionLifecycle(input: EvaluationDraftInput): Promise<void> {
  if (input.category !== "project") return;
  const prefix = "project:";
  if (!input.submissionId.startsWith(prefix)) return;
  const submissionRowId = input.submissionId.slice(prefix.length);
  if (!submissionRowId || submissionRowId.startsWith("demo-")) return;

  try {
    await advanceSubmissionStatus(
      submissionRowId,
      input.judgeId,
      input.status === "evaluated" ? "evaluated" : "under_review",
    );
  } catch {
    /* bookkeeping only — the judge's evaluation is already stored */
  }
}

/** Remove this judge's evaluation for a submission (reverts it to unevaluated). */
export async function deleteEvaluation(
  submissionId: string,
  category: EvaluationCategory,
  judgeId: string | null | undefined,
): Promise<void> {
  const local = (): void => {
    const journal = readJournal();
    const records = journal.evaluations as unknown as JudgeEvaluation[];
    journal.evaluations = records.filter(
      (record) =>
        !(
          record.submissionId === submissionId &&
          record.category === category &&
          record.judgeId === judgeId
        ),
    );
    writeJournal(journal);
  };

  await runJudging(
    canUseRemote(judgeId),
    async () => {
      const supabase = getSupabase();
      const removed = await supabase
        .from("judge_evaluations")
        .delete()
        .eq("submission_id", submissionId)
        .eq("submission_category", category)
        .eq("judge_id", judgeId as string);
      if (removed.error) throw removed.error;
    },
    local,
  );
}
