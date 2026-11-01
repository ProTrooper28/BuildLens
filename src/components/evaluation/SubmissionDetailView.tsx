import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Eye, EyeOff, Loader2, XCircle } from "lucide-react";

import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { SubmissionPreview } from "@/components/evaluation/SubmissionPreview";
import { ScoringPanel } from "@/components/evaluation/ScoringPanel";
import { EvidencePanel } from "@/components/evaluation/EvidenceSection";
import { JudgeSummary } from "@/components/evaluation/JudgeSummary";
import { buildInspectionReport } from "@/services/inspection";
import { setPublishedResult } from "@/services/hackathon.service";
import {
  AiVerdictPanel,
  deriveVerdictFromSubmission,
} from "@/components/evaluation/AiVerdictPanel";
import { useEvidenceRun } from "@/hooks/useEvidenceRun";
import { StatusPill } from "@/components/evaluation/shared";
import { CATEGORY_META } from "@/lib/evaluation/category";
import { notify } from "@/lib/toast-messages";
import { EASE_OUT } from "@/components/motion/primitives";
import { useNavigationDirection } from "@/components/motion/navigation";
import {
  awardedTotal,
  criterionTargets,
  isEvaluationComplete,
  type CriterionTarget,
} from "@/lib/evaluation/scoring";
import {
  useEvaluationRecorder,
  useJudgingQueue,
  useSubmissionDetail,
  useSubmissionEvaluations,
} from "@/hooks/useJudging";
import type { JudgeIdentity } from "@/services/judging/store";
import type {
  CriteriaSet,
  CriterionScore,
  EvaluationCategory,
  EvaluationRecommendation,
  JudgeEvaluation,
  RankedSubmission,
  SubmissionDetail,
} from "@/types/evaluation";
import { cn } from "@/lib/utils";

/**
 * Detail + evaluation screen for one submission.
 *
 * The route resolves data; this component owns the judge's draft. It is keyed by
 * submission id, so moving between submissions remounts the draft (correctly
 * starting from the saved record) while saving a score only patches the cache —
 * the page itself never remounts mid-evaluation.
 */

function seedScores(targets: CriterionTarget[], record: JudgeEvaluation | null): CriterionScore[] {
  return targets.map((target) => ({
    criterionId: target.criterion.id,
    awarded:
      record?.scores.find((score) => score.criterionId === target.criterion.id)?.awarded ?? null,
    note: null,
  }));
}

export function SubmissionDetailRouteView({
  category,
  submissionId,
}: {
  category: EvaluationCategory;
  submissionId: string;
}) {
  const queue = useJudgingQueue(category);
  const detailQuery = useSubmissionDetail(submissionId);
  const evaluators = useSubmissionEvaluations(category, submissionId);

  const myRecord =
    queue.records.find(
      (record) => record.submissionId === submissionId && record.judgeId === queue.judge.id,
    ) ?? null;

  const backTo = category === "resume" ? "/evaluation/resume" : "/evaluation/project";

  if (queue.isLoading || detailQuery.isLoading) {
    return (
      <AppLayout
        title="Loading submission"
        crumbs={[
          { label: "Evaluation", to: "/evaluation" },
          { label: CATEGORY_META[category].plural, to: backTo },
        ]}
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-4">
            <div className="h-40 animate-pulse rounded-xl border border-border/70 bg-card/40" />
            <div className="h-64 animate-pulse rounded-xl border border-border/70 bg-card/30" />
          </div>
          <div className="h-96 animate-pulse rounded-xl border border-border/70 bg-card/40" />
        </div>
      </AppLayout>
    );
  }

  const detail = detailQuery.data ?? null;
  if (!detail) {
    return (
      <AppLayout
        title="Submission not found"
        crumbs={[
          { label: "Evaluation", to: "/evaluation" },
          { label: CATEGORY_META[category].plural, to: backTo },
        ]}
      >
        <div className="rounded-xl border border-border/70 bg-card/40 px-6 py-16 text-center">
          <XCircle className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="mt-3 text-sm font-medium">This submission is no longer available.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been removed from the cohort, or the link is malformed.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to={backTo}>Back to {CATEGORY_META[category].plural.toLowerCase()}</Link>
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <SubmissionDetailView
      key={detail.id}
      category={category}
      detail={detail}
      criteriaSet={queue.criteriaSet}
      judge={queue.judge}
      myRecord={myRecord}
      evaluators={evaluators}
      rows={queue.rows}
    />
  );
}

function SubmissionDetailView({
  category,
  detail,
  criteriaSet,
  judge,
  myRecord,
  evaluators,
  rows,
}: {
  category: EvaluationCategory;
  detail: SubmissionDetail;
  criteriaSet: CriteriaSet;
  judge: JudgeIdentity;
  myRecord: JudgeEvaluation | null;
  evaluators: JudgeEvaluation[];
  rows: RankedSubmission[];
}) {
  const navigate = useNavigate();
  const recorder = useEvaluationRecorder(category);
  // Same motion language as the rest of the app: forward slides in from the right,
  // back from the left, so list → detail and detail → list read as one move.
  const direction = useNavigationDirection();
  // One evidence run per submission, shared by the judge summary, the detailed
  // analysis page and the compact summary beside the scoring criteria.
  // Projects are inspected automatically; resumes keep the manual run.
  const evidence = useEvidenceRun(detail, { autoStart: detail.category === "project" });

  // Deterministic judge report — built from the persisted bundle, so it exists
  // even when the AI stage failed.
  const inspectionReport = useMemo(() => {
    if (detail.category !== "project" || !evidence.bundle) return null;
    return buildInspectionReport({
      detail,
      bundle: evidence.bundle,
      evaluation: evidence.run?.result ?? null,
      runError: evidence.error,
    });
  }, [detail, evidence.bundle, evidence.run, evidence.error]);

  const targets = useMemo(() => criterionTargets(criteriaSet), [criteriaSet]);
  const [scores, setScores] = useState<CriterionScore[]>(() => seedScores(targets, myRecord));
  const [note, setNote] = useState(myRecord?.notes?.body ?? "");
  const [recommendation, setRecommendation] = useState<EvaluationRecommendation>(
    myRecord?.recommendation ?? null,
  );
  const [dirty, setDirty] = useState(false);

  // Published result — the only number a candidate may see.
  const shared = detail.category === "project" ? (detail.sharedSubmission ?? null) : null;
  const [published, setPublished] = useState(shared?.resultPublished ?? false);
  const [publishedResult, setPublishedResultState] = useState(shared?.publishedResult ?? null);
  const [publishing, setPublishing] = useState(false);

  const index = rows.findIndex((row) => row.submission.id === detail.id);
  const previous = index > 0 ? rows[index - 1] : undefined;
  const next = index >= 0 && index < rows.length - 1 ? rows[index + 1] : undefined;
  const total = awardedTotal(scores, targets);
  const complete = isEvaluationComplete(scores, targets);
  const submitted = myRecord?.status === "evaluated" || myRecord?.status === "reviewed";

  // Derived AI verdict from the submission's own fields (incoming feature) —
  // memoised so it does not recompute on every score keystroke.
  const aiVerdict = useMemo(() => deriveVerdictFromSubmission(detail), [detail]);

  const backTo = category === "resume" ? "/evaluation/resume" : "/evaluation/project";
  const listLink = backTo;

  const goTo = (id: string) => {
    if (category === "resume") {
      void navigate({ to: "/evaluation/resume/$id", params: { id } });
    } else {
      void navigate({ to: "/evaluation/project/$id", params: { id } });
    }
  };

  const setScore = (criterionId: string, awarded: number | null) => {
    setDirty(true);
    setScores((previousScores) =>
      previousScores.map((score) =>
        score.criterionId === criterionId ? { ...score, awarded } : score,
      ),
    );
  };

  const persist = async (status: "in_progress" | "evaluated") => {
    const record = await recorder.mutateAsync({
      submissionId: detail.id,
      category,
      judgeId: judge.id,
      judgeName: judge.name,
      scores,
      recommendation,
      note: note.trim() ? { body: note, visibility: "private" } : null,
      criteria: criteriaSet,
      status,
    });
    setDirty(false);
    return record;
  };

  const handleSaveDraft = async () => {
    try {
      await persist("in_progress");
      notify.success("Draft saved", "Only you can see this evaluation until you submit it.");
    } catch {
      notify.error("Couldn't save the draft", "Your scores are still on screen — try again.");
    }
  };

  const handleSubmit = async () => {
    if (!complete) return;
    try {
      const wasSubmitted = submitted;
      await persist("evaluated");
      notify.success(
        wasSubmitted ? "Evaluation updated" : "Evaluation submitted",
        `${detail.name} — ${Math.round(total)} / ${criteriaSet.maxScore}.`,
      );
      // Submitting is a rhythm: move straight to the next submission in the queue.
      if (!wasSubmitted && next) goTo(next.submission.id);
    } catch {
      notify.error("Couldn't submit the evaluation", "Nothing was scored — please try again.");
    }
  };

  /**
   * Leaving the page must not lose a judge's work.
   *
   * A brand-new unsubmitted sheet is filed as a private draft (never as a
   * submission); an already-submitted evaluation keeps its submitted state when it
   * is still complete, and falls back to a draft when criteria were cleared.
   */
  /**
   * Publish (or withdraw) the result the candidate sees.
   *
   * Only the numbers travel: total, maximum, percentage and rank. Judge notes,
   * individual sheets and AI reasoning stay in the judging tables.
   */
  const handlePublish = async () => {
    if (!shared || publishing) return;
    setPublishing(true);
    try {
      const next = !published;
      const percent =
        criteriaSet.maxScore > 0 ? Math.round((total / criteriaSet.maxScore) * 1000) / 10 : 0;
      const updated = await setPublishedResult(
        detail.id.slice("project:".length),
        judge.id,
        next
          ? {
              total: Math.round(total * 10) / 10,
              maxScore: criteriaSet.maxScore,
              percent,
              rank: rows.find((row) => row.submission.id === detail.id)?.rank ?? null,
            }
          : null,
      );
      if (!updated) throw new Error("The result was not saved.");
      setPublished(updated.resultPublished);
      setPublishedResultState(
        updated.publishedResult
          ? {
              total: updated.publishedResult.total,
              maxScore: updated.publishedResult.maxScore,
              rank: updated.publishedResult.rank,
            }
          : null,
      );
      notify.success(
        next ? "Result published" : "Result withdrawn",
        next
          ? "The candidate can now see their published result."
          : "The candidate sees the submission status only.",
      );
    } catch {
      notify.error("Couldn't update the published result", "Your scores are safe — try again.");
    } finally {
      setPublishing(false);
    }
  };

  const handleNavigate = async (direction: "prev" | "next") => {
    const target = direction === "prev" ? previous : next;
    if (!target) return;

    if (dirty) {
      try {
        await persist(submitted && complete ? "evaluated" : "in_progress");
      } catch {
        notify.error("Couldn't save before moving on", "Stay on this page and try again.");
        return;
      }
    }
    goTo(target.submission.id);
  };

  const position = index >= 0 ? `${index + 1} of ${rows.length}` : null;
  const subtitle = (
    detail.category === "resume" ? [detail.subtitle] : [detail.team, detail.projectCategory]
  )
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  return (
    <AppLayout
      title={detail.name}
      subtitle={subtitle || undefined}
      crumbs={[
        { label: "Evaluation", to: "/evaluation" },
        { label: CATEGORY_META[category].plural, to: backTo },
        { label: detail.name },
      ]}
      actions={
        <div className="flex items-center gap-1.5">
          {position && (
            <span className="mr-1 text-xs tabular-nums text-muted-foreground">{position}</span>
          )}
          <Button
            variant="outline"
            size="icon"
            aria-label={previous ? `Previous: ${previous.submission.name}` : "Previous submission"}
            disabled={!previous || recorder.isPending}
            onClick={() => void handleNavigate("prev")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={next ? `Next: ${next.submission.name}` : "Next submission"}
            disabled={!next || recorder.isPending}
            onClick={() => void handleNavigate("next")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link
          to={listLink}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Back to {CATEGORY_META[category].plural.toLowerCase()}
        </Link>
        {index >= 0 && rows[index] && <StatusPill status={rows[index]!.aggregate.status} />}
        {dirty && (
          <span className="inline-flex items-center gap-1 text-xs text-warning">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
            Unsaved changes
          </span>
        )}
        {recorder.isPending && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Saving
          </span>
        )}
      </div>

      <motion.div
        initial={{ opacity: 0, x: direction * 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.32, ease: EASE_OUT }}
        className="grid items-start gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_380px] lg:pb-0 xl:grid-cols-[minmax(0,1fr)_420px]"
      >
        <div className="min-w-0 space-y-5">
          {detail.category === "project" ? (
            <>
              {/* Verdict first: the judge should understand the submission before
                  reading the team's own pitch. */}
              <JudgeSummary
                submissionId={detail.id}
                report={inspectionReport}
                phase={evidence.phase}
                partial={evidence.partial}
                error={evidence.error}
                starting={evidence.starting}
                onStart={evidence.start}
              />
              {shared && (
                <section
                  aria-label="Publish result"
                  className="surface flex flex-wrap items-center gap-3 p-4"
                >
                  <span
                    className={cn(
                      "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
                      published
                        ? "bg-success/10 text-success"
                        : "bg-muted/60 text-muted-foreground",
                    )}
                    aria-hidden
                  >
                    {published ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {published ? "Result published to the candidate" : "Result not published"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {published
                        ? `${publishedResult?.total ?? Math.round(total)} / ${publishedResult?.maxScore ?? criteriaSet.maxScore}${
                            publishedResult?.rank ? ` · Rank #${publishedResult.rank}` : ""
                          }`
                        : `The team sees the submission status only. ${shared.hackathonName} judges keep scores and notes private.`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={published ? "outline" : "default"}
                    disabled={!complete || publishing}
                    title={
                      complete ? undefined : "Score every criterion before publishing a result"
                    }
                    onClick={() => void handlePublish()}
                  >
                    {publishing && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                    {published ? "Withdraw result" : "Publish result"}
                  </Button>
                </section>
              )}
              <SubmissionPreview detail={detail} />
            </>
          ) : (
            <>
              <SubmissionPreview detail={detail} />
              <EvidencePanel
                submission={detail}
                phase={evidence.phase}
                run={evidence.run}
                error={evidence.error}
                starting={evidence.starting}
                onStart={evidence.start}
              />
            </>
          )}
        </div>
        <div id="score-panel" className="min-w-0 scroll-mt-24">
          <ScoringPanel
            targets={targets}
            maxScore={criteriaSet.maxScore}
            criteriaSet={criteriaSet}
            scores={scores}
            onScore={setScore}
            note={note}
            onNoteChange={(value) => {
              setDirty(true);
              setNote(value);
            }}
            recommendation={recommendation}
            onRecommendationChange={(value) => {
              setDirty(true);
              setRecommendation(value);
            }}
            recordStatus={myRecord?.status ?? null}
            submittedAt={myRecord?.submittedAt ?? null}
            saving={recorder.isPending}
            submitting={recorder.isPending}
            dirty={dirty}
            complete={complete}
            onSaveDraft={() => void handleSaveDraft()}
            onSubmit={() => void handleSubmit()}
            evaluators={evaluators}
            judgeId={judge.id}
            evidence={
              evidence.bundle
                ? {
                    counts: evidence.bundle.counts,
                    total: evidence.bundle.claims.length,
                  }
                : null
            }
            aiVerdict={aiVerdict}
          />
        </div>
      </motion.div>

      {/*
       * The field-derived assessment is the fallback for a submission with no
       * inspection yet (and for resumes). Once a project report exists, its AI
       * section is the grounded one — showing both would hand the judge two AI
       * summaries with different origins.
       */}
      {!inspectionReport && (
        <div className="mt-6 pb-6">
          <AiVerdictPanel verdict={aiVerdict} />
        </div>
      )}

      {/* Mobile quick bar: keep the running total and the way forward in reach. */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-border/80 bg-background/90 px-4 py-3 backdrop-blur-md lg:hidden",
        )}
      >
        <div className="tabular-nums leading-tight">
          <div className="text-sm font-semibold">
            {Math.round(total * 10) / 10}
            <span className="text-xs font-normal text-muted-foreground">
              {" "}
              / {criteriaSet.maxScore}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {complete
              ? "Ready to submit"
              : `${targets.length - scores.filter((s) => s.awarded !== null).length} to score`}
          </div>
        </div>
        <Button variant="outline" size="sm" className="ml-auto" asChild>
          <a href="#score-panel">Score</a>
        </Button>
        <Button
          size="sm"
          disabled={!complete || recorder.isPending}
          onClick={() => void handleSubmit()}
        >
          {submitted ? "Update" : "Submit"}
        </Button>
      </div>
    </AppLayout>
  );
}
