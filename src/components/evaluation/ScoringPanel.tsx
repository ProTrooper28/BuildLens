import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Info, Loader2, Lock, Save, Send, Settings2, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Meter, SectionHeading } from "@/components/evaluation/shared";
import { EASE_OUT } from "@/components/motion/primitives";
import { aiEvaluationStatus } from "@/services/judging/ai-evaluation.service";
import { AiVerdictInline, type AiVerdictData } from "@/components/evaluation/AiVerdictPanel";
import type { ClaimEvidenceStatus } from "@/services/evidence/types";
import { awardedTotal, percentOf, type CriterionTarget } from "@/lib/evaluation/scoring";
import { cn } from "@/lib/utils";
import type {
  CriteriaSet,
  CriterionScore,
  EvaluationRecommendation,
  EvaluationRecordStatus,
  JudgeEvaluation,
} from "@/types/evaluation";

/**
 * The evaluation panel.
 *
 * Presentational and controlled: the detail view owns the draft, this renders it.
 * That split is what lets "Next submission" save the draft before navigating
 * without the panel being remounted or losing a keystroke.
 */

const RECOMMENDATIONS: { value: Exclude<EvaluationRecommendation, null>; label: string }[] = [
  { value: "strong_yes", label: "Strong yes" },
  { value: "yes", label: "Yes" },
  { value: "maybe", label: "Maybe" },
  { value: "no", label: "No" },
  { value: "strong_no", label: "Strong no" },
];

export interface ScoringPanelProps {
  targets: CriterionTarget[];
  maxScore: number;
  criteriaSet?: CriteriaSet;
  scores: CriterionScore[];
  onScore: (criterionId: string, awarded: number | null) => void;
  note: string;
  onNoteChange: (value: string) => void;
  recommendation: EvaluationRecommendation;
  onRecommendationChange: (value: EvaluationRecommendation) => void;
  recordStatus: EvaluationRecordStatus | null;
  submittedAt: string | null;
  saving: boolean;
  submitting: boolean;
  dirty: boolean;
  complete: boolean;
  onSaveDraft: () => void;
  onSubmit: () => void;
  evaluators: JudgeEvaluation[];
  judgeId: string;
  /** Claim-status tally from the evidence run, so scores can reference it. */
  evidence?: { counts: Record<ClaimEvidenceStatus, number>; total: number } | null;
  /** AI Verdict derived from the submission — shown as a teaser. */
  aiVerdict?: AiVerdictData | null;
  className?: string;
}

export function ScoringPanel({
  targets,
  maxScore,
  criteriaSet,
  scores,
  onScore,
  note,
  onNoteChange,
  recommendation,
  onRecommendationChange,
  recordStatus,
  submittedAt,
  saving,
  submitting,
  dirty,
  complete,
  onSaveDraft,
  onSubmit,
  evaluators,
  judgeId,
  evidence,
  aiVerdict,
  className,
}: ScoringPanelProps) {
  const total = awardedTotal(scores, targets);
  const percent = percentOf(total, maxScore) ?? 0;
  const submitted = recordStatus === "evaluated" || recordStatus === "reviewed";
  const ai = aiEvaluationStatus();
  const missing = targets.filter((target) => {
    const score = scores.find((entry) => entry.criterionId === target.criterion.id);
    return !score || score.awarded === null;
  }).length;

  return (
    <Card
      className={cn("flex min-w-0 flex-col border-border bg-card lg:sticky lg:top-20", className)}
    >
      <CardHeader className="space-y-3 border-b border-border/70 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-medium">Your evaluation</CardTitle>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>
                {targets.length} criteria · max {maxScore}
              </span>
              {criteriaSet && (
                <Link
                  to="/evaluation/criteria"
                  search={{ category: criteriaSet.category }}
                  className="inline-flex items-center gap-0.5 rounded text-[10px] text-primary/70 transition-colors hover:text-primary"
                  title="Edit scoring criteria"
                >
                  <Settings2 className="h-3 w-3" aria-hidden />
                  Edit
                </Link>
              )}
            </div>
          </div>
          {submitted ? (
            <Badge variant="outline" className="border-border text-success">
              <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />
              Submitted
            </Badge>
          ) : recordStatus === "in_progress" ? (
            <Badge variant="outline" className="border-border text-warning">
              Draft
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Not started
            </Badge>
          )}
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-1.5 tabular-nums">
              <motion.span
                key={Math.round(total)}
                initial={{ opacity: 0.6, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: EASE_OUT }}
                className="text-2xl font-semibold"
              >
                {Math.round(total * 10) / 10}
              </motion.span>
              <span className="text-sm text-muted-foreground">/ {maxScore}</span>
            </div>
            <span className="text-sm font-medium tabular-nums text-muted-foreground">
              {Math.round(percent)}%
            </span>
          </div>
          <Meter value={percent / 100} className="mt-2" tone={submitted ? "success" : "primary"} />
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {/* Criteria ---------------------------------------------------- */}
        <div className="space-y-3">
          {targets.map((target) => {
            const score = scores.find((entry) => entry.criterionId === target.criterion.id);
            const awarded = score?.awarded ?? null;
            const atMax = awarded !== null && awarded >= target.points;
            return (
              <div
                key={target.criterion.id}
                className="rounded-lg border border-border/60 bg-background/40 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-tight">{target.criterion.name}</p>
                    {target.criterion.description && (
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                        {target.criterion.description}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={target.points}
                      step={1}
                      value={awarded ?? ""}
                      placeholder="—"
                      onChange={(event) => {
                        const raw = event.target.value;
                        if (raw === "") return onScore(target.criterion.id, null);
                        const parsed = Number(raw);
                        if (!Number.isFinite(parsed)) return;
                        onScore(
                          target.criterion.id,
                          Math.max(0, Math.min(target.points, Math.round(parsed))),
                        );
                      }}
                      aria-label={`${target.criterion.name} score out of ${target.points}`}
                      className={cn(
                        "h-8 w-16 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                        atMax && "border-success/40 text-success",
                      )}
                    />
                    <span className="text-xs tabular-nums text-muted-foreground">
                      / {target.points}
                    </span>
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={target.points}
                  step={1}
                  value={awarded ?? 0}
                  onChange={(event) => onScore(target.criterion.id, Number(event.target.value))}
                  aria-label={`${target.criterion.name} slider`}
                  className="mt-2.5 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                />
              </div>
            );
          })}
        </div>
        {/* Evidence ---------------------------------------------------- */}
        {evidence && evidence.total > 0 && (
          <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <SectionHeading>Evidence check</SectionHeading>
              <a
                href="#evidence-section"
                className="text-[11px] text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                Why?
              </a>
            </div>
            <ul className="mt-1.5 space-y-1 text-[11px]">
              <li className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Supported</span>
                <span className="tabular-nums text-success">{evidence.counts.supported}</span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Partially supported</span>
                <span className="tabular-nums text-warning">
                  {evidence.counts.partially_supported}
                </span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Not found in readable sources</span>
                <span className="tabular-nums">{evidence.counts.not_found}</span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Could not verify</span>
                <span className="tabular-nums text-primary">
                  {evidence.counts.could_not_verify}
                </span>
              </li>
            </ul>
            <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
              {evidence.total} claims checked. “Could not verify” is a gap in the evidence, not a
              negative finding — do not penalise it as if it were false.
            </p>
          </div>
        )}{" "}
        {/* AI layer ---------------------------------------------------- */}
        {aiVerdict ? (
          <AiVerdictInline verdict={aiVerdict} />
        ) : (
          <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-3 py-2.5">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              AI score
              <Badge variant="outline" className="ml-auto text-[10px] font-normal">
                {ai.available ? "Connected" : "Unavailable"}
              </Badge>
            </div>
            <p className="mt-1 text-[11px] font-medium text-foreground/80">{ai.label}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              {ai.description} No AI score is generated today — the evidence check above is advisory
              and never writes your marks.
            </p>
          </div>
        )}
        {/* Notes ------------------------------------------------------- */}
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <SectionHeading>Judge notes</SectionHeading>
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Lock className="h-3 w-3" aria-hidden /> Private
            </span>
          </div>
          <textarea
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            rows={4}
            placeholder="Strong technical implementation but weak UX. Note the evidence you used."
            aria-label="Private judge notes"
            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Kept separate from the score and never shown to the candidate.
          </p>
        </div>
        {/* Recommendation ---------------------------------------------- */}
        <div>
          <SectionHeading className="mb-1.5">Recommendation</SectionHeading>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Recommendation">
            {RECOMMENDATIONS.map((option) => {
              const active = recommendation === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onRecommendationChange(active ? null : option.value)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                    active
                      ? "border-primary/40 bg-primary/[0.12] text-foreground"
                      : "border-border/70 text-muted-foreground hover:border-primary/30 hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
        {/* Panel ------------------------------------------------------- */}
        <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2.5">
          <SectionHeading className="mb-1.5">Evaluation panel</SectionHeading>
          <ul className="space-y-1.5">
            {evaluators.length === 0 ? (
              <li className="text-[11px] text-muted-foreground">Nobody has scored this yet.</li>
            ) : (
              evaluators.map((evaluator) => (
                <li key={evaluator.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className={cn("truncate", evaluator.judgeId === judgeId && "font-medium")}>
                    {evaluator.judgeId === judgeId ? "You" : (evaluator.judgeName ?? "Judge")}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {evaluator.status === "in_progress"
                      ? "Draft"
                      : evaluator.status === "reviewed"
                        ? "Reviewed"
                        : "Submitted"}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
        {/* Actions ----------------------------------------------------- */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={onSaveDraft}
              disabled={saving || submitting || !dirty}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save draft
            </Button>
            <Button
              size="sm"
              className="flex-1"
              onClick={onSubmit}
              disabled={!complete || submitting}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {submitted ? "Update evaluation" : "Submit evaluation"}
            </Button>
          </div>
          {!complete && (
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              Score all {targets.length} criteria to submit ({missing} left). Drafts are saved
              privately.
            </p>
          )}
          {submitted && submittedAt && (
            <p className="text-[11px] text-muted-foreground">
              Submitted {new Date(submittedAt).toLocaleString()}. Updating replaces your previous
              scores.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
