import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  FileText,
  Gavel,
  Github,
  Globe,
  Lock,
  MessageSquarePlus,
  Scale,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScoreRing } from "@/components/ScoreRing";
import { ScoringPanel } from "@/components/evaluation/ScoringPanel";
import { JudgeCopilotPanel } from "@/components/hackathons/JudgeCopilotPanel";
import { portalKeys, useJudgeProject } from "@/hooks/useHackathonPortal";
import { useEvaluationRecorder, useJudgeIdentity } from "@/hooks/useJudging";
import { awardedTotal, criterionTargets } from "@/lib/evaluation/scoring";
import { buildReportInsights, type ReportInsights } from "@/lib/report-insights";
import { notify } from "@/lib/toast-messages";
import { setPublishedResult, submissionStatusLabel } from "@/services/hackathon.service";
import type { JudgeProject } from "@/services/portal.service";
import { cn } from "@/lib/utils";
import type {
  CriterionScore,
  EvaluationRecommendation,
  JudgeEvaluation,
  JudgeQuestion,
  JudgeReview,
} from "@/types/evaluation";

/**
 * One submission, one page: what the candidate sent, the BuildLens analysis, the
 * judge's own rubric and the comparison between them.
 *
 * Everything is read from the shared records the candidate portal wrote — the
 * submission row, its report and this judge's evaluation. Saving a score never
 * touches the analysis, and the analysis never overwrites a judge: the two numbers
 * are stored side by side and the judge's carries the final authority.
 */

type ProjectTab = "submission" | "ai" | "copilot" | "manual" | "compare";

/** One rubric line with the score the AI score implies for it. */
type CriterionSuggestion = {
  target: { criterion: { id: string; name: string }; points: number };
  suggested: number | null;
};

const TABS: { id: ProjectTab; label: string; icon: typeof FileText }[] = [
  { id: "submission", label: "View submission", icon: FileText },
  { id: "ai", label: "AI evaluation", icon: Sparkles },
  { id: "copilot", label: "Questions & review", icon: MessageSquarePlus },
  { id: "manual", label: "Manual evaluation", icon: Gavel },
  { id: "compare", label: "Compare", icon: Scale },
];

export function RealProjectPage({ code, submissionId }: { code: string; submissionId: string }) {
  const project = useJudgeProject(code, submissionId);

  if (project.isLoading) {
    return (
      <AppLayout title="Loading project" crumbs={[{ label: "Hackathons", to: "/hackathons" }]}>
        <div className="space-y-4">
          <div className="h-28 animate-pulse rounded-xl border border-border/70 bg-card/40" />
          <div className="h-72 animate-pulse rounded-xl border border-border/70 bg-card/30" />
        </div>
      </AppLayout>
    );
  }

  const data = project.data ?? null;
  if (!data) {
    return (
      <AppLayout title="Project not found" crumbs={[{ label: "Hackathons", to: "/hackathons" }]}>
        <div className="rounded-xl border border-border/70 bg-card/40 px-6 py-14 text-center">
          <TriangleAlert className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="mt-3 text-sm font-medium">This submission isn't available here.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            It may belong to another hackathon, or you don't have judge access to it.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to="/hackathons/$code" params={{ code }} search={{ view: "projects" }}>
              Back to {code}
            </Link>
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <ProjectView key={data.submission.id} code={code} data={data} onRefresh={project.refetch} />
  );
}

/* ------------------------------------------------------------ inner view */

function ProjectView({
  code,
  data,
  onRefresh,
}: {
  code: string;
  data: JudgeProject;
  onRefresh: () => void;
}) {
  const { hackathon, submission, analysis, myEvaluation, criteria } = data;
  const judge = useJudgeIdentity();
  const recorder = useEvaluationRecorder("project");
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<ProjectTab>("submission");
  const targets = useMemo(() => criterionTargets(criteria), [criteria]);
  const [scores, setScores] = useState<CriterionScore[]>(() =>
    targets.map((target) => ({
      criterionId: target.criterion.id,
      awarded:
        myEvaluation?.scores.find((score) => score.criterionId === target.criterion.id)?.awarded ??
        null,
      note: null,
    })),
  );
  const [note, setNote] = useState(myEvaluation?.notes?.body ?? "");
  const [recommendation, setRecommendation] = useState<EvaluationRecommendation>(
    myEvaluation?.recommendation ?? null,
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const insights: ReportInsights | null = analysis.view ? buildReportInsights(analysis.view) : null;
  const aiScore = analysis.score;
  const suggestions = useMemo(
    () =>
      targets.map((target) => ({
        target,
        suggested:
          aiScore === null
            ? null
            : Math.round((Math.min(100, Math.max(0, aiScore)) / 100) * target.points),
      })),
    [targets, aiScore],
  );

  const awarded = awardedTotal(scores, targets);
  const complete =
    targets.length > 0 &&
    targets.every((target) =>
      scores.some((score) => score.criterionId === target.criterion.id && score.awarded !== null),
    );
  const submittedRecord =
    myEvaluation && myEvaluation.status !== "in_progress" ? myEvaluation : null;
  const judgeScore = submittedRecord ? awardedTotal(submittedRecord.scores, targets) : null;
  const finalScore =
    judgeScore ?? (submission.resultPublished ? (submission.publishedResult?.total ?? null) : null);
  const finalMax =
    judgeScore !== null
      ? criteria.maxScore
      : (submission.publishedResult?.maxScore ?? criteria.maxScore);

  const setScore = (criterionId: string, value: number | null) => {
    setDirty(true);
    setScores((previous) =>
      previous.map((score) =>
        score.criterionId === criterionId ? { ...score, awarded: value } : score,
      ),
    );
  };

  const persist = async (
    status: "in_progress" | "evaluated",
    copilot?: { questions?: JudgeQuestion[]; review?: JudgeReview | null },
  ) => {
    const record: JudgeEvaluation = await recorder.mutateAsync({
      submissionId: `project:${submission.id}`,
      category: "project",
      judgeId: judge.id,
      judgeName: judge.name,
      scores,
      recommendation,
      note: note.trim() ? { body: note, visibility: "private" } : null,
      criteria,
      status,
      ...(copilot?.questions !== undefined ? { questions: copilot.questions } : {}),
      ...(copilot?.review !== undefined ? { review: copilot.review } : {}),
    });
    setDirty(false);
    return record;
  };

  /** Persist question state without touching scores or the submission status. */
  const saveQuestions = async (questions: JudgeQuestion[]) => {
    setSaving(true);
    try {
      await persist("in_progress", { questions });
      notify.success("Questions saved", "The state is stored with this submission.");
      await refreshAll();
    } catch {
      notify.error("Couldn't save the questions", "Nothing was lost on screen — try again.");
    } finally {
      setSaving(false);
    }
  };

  const saveReview = async (review: JudgeReview) => {
    setSaving(true);
    try {
      await persist("in_progress", { review });
      notify.success("Review saved", "Only judges can see this review.");
      await refreshAll();
    } catch {
      notify.error("Couldn't save the review", "Your text is still on screen — try again.");
    } finally {
      setSaving(false);
    }
  };

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: portalKeys.workspace(code, judge.id) }),
      queryClient.invalidateQueries({
        queryKey: portalKeys.project(code, submission.id, judge.id),
      }),
    ]);
    onRefresh();
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      await persist("in_progress");
      notify.success("Draft saved", "Only you can see this evaluation until you submit it.");
      await refreshAll();
    } catch {
      notify.error("Couldn't save the draft", "Your scores are still on screen — try again.");
    } finally {
      setSaving(false);
    }
  };

  const submitEvaluation = async () => {
    if (!complete) return;
    setSubmitting(true);
    try {
      await persist("evaluated");
      notify.success(
        "Evaluation submitted",
        `${criteria.maxScore} points rubric · ${Math.round(awarded)} awarded.`,
      );
      await refreshAll();
    } catch {
      notify.error(
        "Couldn't submit the evaluation",
        "Your scores are still on screen — try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const applyAiSuggestion = () => {
    if (aiScore === null) return;
    setDirty(true);
    setScores((previous) =>
      previous.map((score) => {
        const suggestion = suggestions.find(
          (entry) => entry.target.criterion.id === score.criterionId,
        );
        return suggestion?.suggested === null || suggestion?.suggested === undefined
          ? score
          : { ...score, awarded: suggestion.suggested };
      }),
    );
    notify.info(
      "AI suggestion applied",
      "Edit any criterion before you submit — you have the last word.",
    );
  };

  const publish = async (publish: boolean) => {
    setPublishing(true);
    try {
      const total = publish ? (judgeScore ?? awarded) : 0;
      await setPublishedResult(
        submission.id,
        judge.id,
        publish
          ? {
              total,
              maxScore: criteria.maxScore,
              percent: criteria.maxScore > 0 ? (total / criteria.maxScore) * 100 : 0,
              rank: null,
            }
          : null,
      );
      notify.success(
        publish ? "Result published" : "Result withdrawn",
        publish
          ? "The candidate can now see this score on their own submission page."
          : "The candidate's page no longer shows a score.",
      );
      await refreshAll();
    } catch {
      notify.error("Couldn't update the result", "Nothing was published — try again.");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <AppLayout
      title={data.projectName}
      subtitle={`${hackathon.name} · ${submission.teamName} · ${submissionStatusLabel(submission.status)}`}
      crumbs={[
        { label: "Hackathons", to: "/hackathons" },
        { label: hackathon.name, to: `/hackathons/${hackathon.code}` },
        { label: data.projectName },
      ]}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono tracking-[0.14em]">
            {hackathon.code}
          </Badge>
          <Badge variant="outline" className="text-[11px]">
            {submissionStatusLabel(submission.status)}
          </Badge>
        </div>
      }
    >
      <div className="space-y-5">
        <Link
          to="/hackathons/$code"
          params={{ code: hackathon.code }}
          search={{ view: "projects" }}
          className="group inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" />
          {hackathon.name} submissions
        </Link>

        {/* Score strip: the two scores side by side, never merged silently. */}
        <section className="surface grid gap-4 p-5 sm:grid-cols-3">
          <div className="flex items-center gap-4">
            <ScoreRing value={aiScore} label="/ 100" />
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">AI score</p>
              <p className="mt-1 font-mono text-xl font-semibold tabular-nums">
                {aiScore ?? "—"}
                <span className="text-sm font-normal text-muted-foreground">/100</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">BuildLens analysis</p>
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Judge score</p>
            <p className="mt-1 font-mono text-xl font-semibold tabular-nums">
              {judgeScore ?? "—"}
              <span className="text-sm font-normal text-muted-foreground">
                /{criteria.maxScore}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {submittedRecord
                ? "Submitted by you"
                : myEvaluation
                  ? "Draft saved"
                  : "Not scored yet"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Final score</p>
            <p className="mt-1 font-mono text-xl font-semibold tabular-nums">
              {finalScore ?? "—"}
              <span className="text-sm font-normal text-muted-foreground">
                /{finalMax ?? criteria.maxScore}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {judgeScore !== null
                ? "The judge's score carries final authority"
                : "No judge score yet — the AI score stands alone"}
            </p>
          </div>
        </section>

        <div
          role="tablist"
          aria-label="Project sections"
          className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-border/70 bg-card/60 p-1"
        >
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                tab === id
                  ? "border border-primary/20 bg-primary/[0.09] text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>

        {tab === "submission" ? (
          <SubmissionPanel data={data} />
        ) : tab === "ai" ? (
          <AnalysisPanel data={data} insights={insights} />
        ) : tab === "copilot" ? (
          <JudgeCopilotPanel
            view={analysis.view}
            storedQuestions={myEvaluation?.questions ?? []}
            storedReview={myEvaluation?.review ?? null}
            saving={saving || recorder.isPending}
            onSaveQuestions={saveQuestions}
            onSaveReview={saveReview}
          />
        ) : tab === "manual" ? (
          <ManualPanel
            aiScore={aiScore}
            suggestions={suggestions}
            onApplyAi={applyAiSuggestion}
            panel={
              <ScoringPanel
                targets={targets}
                maxScore={criteria.maxScore}
                criteriaSet={criteria}
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
                recordStatus={myEvaluation?.status ?? null}
                submittedAt={myEvaluation?.submittedAt ?? null}
                saving={saving || recorder.isPending}
                submitting={submitting}
                dirty={dirty}
                complete={complete}
                onSaveDraft={() => void saveDraft()}
                onSubmit={() => void submitEvaluation()}
                evaluators={data.evaluations}
                judgeId={judge.id}
              />
            }
          />
        ) : (
          <ComparePanel
            criteriaMax={criteria.maxScore}
            aiScore={aiScore}
            judgeScore={judgeScore}
            finalScore={finalScore}
            total={awarded}
            suggestions={suggestions}
            scores={scores}
            published={submission.resultPublished}
            publishedTotal={submission.publishedResult?.total ?? null}
            publishing={publishing}
            canPublish={judgeScore !== null}
            onPublish={(value) => void publish(value)}
          />
        )}
      </div>
    </AppLayout>
  );
}

/* ---------------------------------------------------------------- panels */

function SubmissionPanel({ data }: { data: JudgeProject }) {
  const { submission, hackathon } = data;
  return (
    <section className="surface space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            What the candidate submitted
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Exactly as sent — the judges never re-enter submission data.
          </p>
        </div>
        <Badge variant="outline">{submissionStatusLabel(submission.status)}</Badge>
      </div>

      <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Team</dt>
          <dd className="mt-0.5">{submission.teamName}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Hackathon</dt>
          <dd className="mt-0.5">
            {hackathon.name}{" "}
            <span className="font-mono text-xs text-muted-foreground">{hackathon.code}</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Submitted</dt>
          <dd className="mt-0.5">{new Date(submission.submittedAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            Evaluation status
          </dt>
          <dd className="mt-0.5">
            {submission.resultPublished ? "Result published" : "Judging in progress"}
          </dd>
        </div>
      </dl>

      <div>
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Team members</p>
        {submission.teamMembers.length > 0 ? (
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {submission.teamMembers.map((member) => (
              <li key={member}>{member}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">No team members were listed.</p>
        )}
      </div>

      {submission.description ? (
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Description</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {submission.description}
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          Links & documents
        </p>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2">
            <Github className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            {submission.repoUrl ? (
              <a
                href={submission.repoUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {submission.repoUrl} <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              <span className="text-muted-foreground">No repository submitted</span>
            )}
          </li>
          <li className="flex items-center gap-2">
            <Globe className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            {submission.websiteUrl ? (
              <a
                href={submission.websiteUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {submission.websiteUrl} <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              <span className="text-muted-foreground">No deployment URL submitted</span>
            )}
          </li>
          <li className="flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            {submission.deckName ? (
              <span>{submission.deckName}</span>
            ) : (
              <span className="text-muted-foreground">No deck attached</span>
            )}
          </li>
        </ul>
      </div>
    </section>
  );
}

function AnalysisPanel({
  data,
  insights,
}: {
  data: JudgeProject;
  insights: ReportInsights | null;
}) {
  const { analysis, reportId } = data;

  if (!analysis.view || !insights) {
    const message =
      analysis.readiness === "running"
        ? "Analysis in progress."
        : analysis.readiness === "failed"
          ? "Analysis couldn't be completed."
          : "This submission has no completed analysis yet.";
    return (
      <section className="surface space-y-3 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          AI evaluation
        </h2>
        <p className="text-sm text-muted-foreground">{message}</p>
        <p className="text-xs text-muted-foreground">
          The BuildLens report appears here the moment the analysis run finishes. You can score the
          submission manually in the meantime — the analysis never blocks judging.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link
            to="/hackathons/$code"
            params={{ code: data.hackathon.code }}
            search={{ view: "projects" }}
          >
            Back to submissions
          </Link>
        </Button>
      </section>
    );
  }

  const counts = insights.claimCounts;

  return (
    <section className="surface space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            AI evaluation
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Built from the submitted documents, the repository and the measured deployment — every
            number is traceable to evidence.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-[11px] uppercase tracking-wide">
            {insights.verdict.label}
          </Badge>
          {reportId ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/report/$id" params={{ id: reportId }}>
                Open full analysis <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        {insights.summary.map((sentence, index) => (
          <p key={index} className="text-sm leading-relaxed text-foreground/90">
            {sentence}
          </p>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            Claims analyzed
          </p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums">{counts.total}</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Verified</p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-success">
            {counts.supported}
          </p>
        </div>
        <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Unsupported</p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-destructive">
            {counts.unsupported}
          </p>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Score breakdown
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {insights.scoreboard.categories.map((category) => (
              <li key={category.key} className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">{category.label}</span>
                <span className="font-mono tabular-nums">
                  {category.points === null ? (
                    <span className="text-muted-foreground">Not measured</span>
                  ) : (
                    <>
                      {category.points}
                      <span className="text-muted-foreground">/{category.max}</span>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Measured performance
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {insights.performance.map((metric) => (
              <li key={metric.name} className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">{metric.name}</span>
                <span className="font-mono tabular-nums">
                  {metric.value ?? <span className="text-muted-foreground">Not measured</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {insights.security.issues.length > 0 ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Security findings
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {insights.security.issues.slice(0, 4).map((issue) => (
              <li key={issue.title} className="flex items-baseline gap-2">
                <Badge variant="outline" className="text-[10px] uppercase">
                  {issue.severity}
                </Badge>
                <span className="min-w-0">{issue.title}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Most important findings
        </p>
        <ul className="mt-2 space-y-2">
          {insights.findings.map((finding, index) => (
            <li
              key={`${finding.title}-${index}`}
              className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
            >
              <span
                className={cn(
                  "mt-2 h-2 w-2 shrink-0 rounded-full",
                  finding.tone === "critical"
                    ? "bg-destructive"
                    : finding.tone === "important"
                      ? "bg-warning"
                      : "bg-success",
                )}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium leading-snug">{finding.title}</p>
                {finding.detail ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{finding.detail}</p>
                ) : null}
              </div>
            </li>
          ))}
          {insights.findings.length === 0 ? (
            <li className="text-sm text-muted-foreground">No findings were recorded.</li>
          ) : null}
        </ul>
      </div>

      <p className="text-xs text-muted-foreground">
        Score, claim verification, functionality, deployment, performance, security, code quality
        and documentation are all on the full analysis page — this tab is the judge's summary.
      </p>
    </section>
  );
}

function ManualPanel({
  panel,
  aiScore,
  suggestions,
  onApplyAi,
}: {
  panel: ReactNode;
  aiScore: number | null;
  suggestions: CriterionSuggestion[];
  onApplyAi: () => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div>{panel}</div>
      <section className="surface h-fit space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <Sparkles className="h-4 w-4" aria-hidden /> AI-assisted
        </h2>
        {aiScore === null ? (
          <p className="text-sm text-muted-foreground">
            No AI score is available for this submission yet, so there is nothing to suggest. Score
            it manually — the two evaluations are stored separately either way.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              The AI score of <span className="font-mono text-foreground">{aiScore}/100</span>{" "}
              scaled onto this rubric. Accept it, change any value, or ignore it: the judge always
              has the final word.
            </p>
            <ul className="space-y-1.5 text-xs">
              {suggestions.map((entry) => (
                <li
                  key={entry.target.criterion.id}
                  className="flex items-baseline justify-between gap-2"
                >
                  <span className="min-w-0 truncate text-muted-foreground">
                    {entry.target.criterion.name}
                  </span>
                  <span className="font-mono tabular-nums">
                    {entry.suggested === null ? "—" : entry.suggested}
                    <span className="text-muted-foreground">/{entry.target.points}</span>
                  </span>
                </li>
              ))}
            </ul>
            <Button variant="outline" size="sm" onClick={onApplyAi}>
              Use AI suggestion
            </Button>
          </>
        )}
      </section>
    </div>
  );
}

function ComparePanel({
  criteriaMax,
  aiScore,
  judgeScore,
  finalScore,
  total,
  suggestions,
  scores,
  published,
  publishedTotal,
  publishing,
  canPublish,
  onPublish,
}: {
  criteriaMax: number;
  aiScore: number | null;
  judgeScore: number | null;
  finalScore: number | null;
  total: number;
  suggestions: CriterionSuggestion[];
  scores: CriterionScore[];
  published: boolean;
  publishedTotal: number | null;
  publishing: boolean;
  canPublish: boolean;
  onPublish: (publish: boolean) => void;
}) {
  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "AI score", value: aiScore, max: 100, hint: "BuildLens analysis" },
          { label: "Judge score", value: judgeScore, max: criteriaMax, hint: "Your rubric" },
          {
            label: "Final score",
            value: finalScore,
            max: judgeScore !== null ? criteriaMax : 100,
            hint: judgeScore !== null ? "Judge score applies" : "AI score applies",
          },
        ].map((card) => (
          <div key={card.label} className="surface p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {card.label}
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
              {card.value ?? "—"}
              <span className="text-sm font-normal text-muted-foreground">/{card.max}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{card.hint}</p>
          </div>
        ))}
      </div>

      <div className="surface overflow-hidden">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-2 font-semibold">Criterion</th>
              <th className="px-3 py-2 text-right font-semibold">Max</th>
              <th className="px-3 py-2 text-right font-semibold">AI suggests</th>
              <th className="px-3 py-2 text-right font-semibold">Judge</th>
            </tr>
          </thead>
          <tbody>
            {suggestions.map((entry) => {
              const awardedScore = scores.find(
                (score) => score.criterionId === entry.target.criterion.id,
              );
              return (
                <tr
                  key={entry.target.criterion.id}
                  className="border-b border-border/40 last:border-0"
                >
                  <td className="px-5 py-2.5">{entry.target.criterion.name}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                    {entry.target.points}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                    {entry.suggested ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                    {awardedScore?.awarded ?? "—"}
                  </td>
                </tr>
              );
            })}
            <tr className="bg-muted/20">
              <td className="px-5 py-2.5 font-medium">Total</td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums">{criteriaMax}</td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                {aiScore ?? "—"}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold">
                {judgeScore ?? (total > 0 ? `${total} (draft)` : "—")}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="surface flex flex-wrap items-center gap-3 p-5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {published ? "Result published to the candidate" : "Publish the result"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {published
              ? `The candidate sees ${publishedTotal ?? "—"} / ${criteriaMax} on their submission page. Judge notes stay private.`
              : "Only the total is published — never your notes or the AI reasoning."}
          </p>
        </div>
        {published ? (
          <Button
            variant="outline"
            size="sm"
            disabled={publishing}
            onClick={() => onPublish(false)}
          >
            Withdraw result
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={publishing || !canPublish}
            onClick={() => onPublish(true)}
            title={canPublish ? undefined : "Submit a judge evaluation first"}
          >
            <CheckCircle2 className="h-4 w-4" /> Publish result
          </Button>
        )}
        {!canPublish && !published ? (
          <p className="flex w-full items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden /> Submit your evaluation in the manual tab
            first.
          </p>
        ) : null}
      </div>
    </section>
  );
}
