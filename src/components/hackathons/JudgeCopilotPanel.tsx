import { useMemo, useState } from "react";
import {
  BadgeCheck,
  Check,
  CircleHelp,
  ListChecks,
  MessageSquarePlus,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buildJudgeQuestions, mergeQuestionState } from "@/services/inspection/copilot";
import type { ReportView } from "@/lib/report-data";
import { cn } from "@/lib/utils";
import type {
  EvaluationRecommendation,
  JudgeQuestion,
  JudgeQuestionStatus,
  JudgeReview,
} from "@/types/evaluation";

/**
 * JUDGE COPILOT — questions to ask and the mentor's own review.
 *
 * Two things live here because they belong to the same moment: the questions the
 * evidence suggests, and the judgement the mentor makes. Both persist with the
 * evaluation, so a refresh never loses a question that was marked asked or a
 * review that was written.
 *
 * Generated questions are regenerated from the report every time (they follow the
 * evidence); only their state — pending / asked / answered, and any note — is
 * stored. Judge-written questions are stored whole.
 */

const RECOMMENDATIONS: { value: Exclude<EvaluationRecommendation, null>; label: string }[] = [
  { value: "strong_yes", label: "Strong candidate" },
  { value: "yes", label: "Consider" },
  { value: "maybe", label: "Needs improvement" },
  { value: "no", label: "Not recommended" },
  { value: "strong_no", label: "Reject" },
];

const PRIORITY_TONE: Record<JudgeQuestion["priority"], string> = {
  high: "border-destructive/30 bg-destructive/8 text-destructive",
  medium: "border-warning/30 bg-warning/8 text-warning",
  low: "border-border bg-muted/50 text-muted-foreground",
};

const STATUS_TONE: Record<JudgeQuestionStatus, string> = {
  pending: "border-border bg-muted/50 text-muted-foreground",
  asked: "border-primary/25 bg-primary/[0.08] text-primary",
  answered: "border-success/30 bg-success/10 text-success",
};

function emptyReview(): JudgeReview {
  return {
    assessment: "",
    strengths: [],
    weaknesses: [],
    suggestions: [],
    concerns: [],
    recommendation: null,
    updatedAt: new Date().toISOString(),
  };
}

export function JudgeCopilotPanel({
  view,
  storedQuestions,
  storedReview,
  saving,
  onSaveQuestions,
  onSaveReview,
}: {
  view: ReportView | null;
  storedQuestions: JudgeQuestion[] | null | undefined;
  storedReview: JudgeReview | null | undefined;
  saving: boolean;
  onSaveQuestions: (questions: JudgeQuestion[]) => Promise<void>;
  onSaveReview: (review: JudgeReview) => Promise<void>;
}) {
  const generated = useMemo(() => (view ? buildJudgeQuestions(view) : []), [view]);
  const [questions, setQuestions] = useState<JudgeQuestion[]>(() =>
    mergeQuestionState(generated, storedQuestions),
  );
  const draft = storedReview ?? emptyReview();
  const [review, setReview] = useState<JudgeReview>(draft);
  const [custom, setCustom] = useState("");
  const [openNote, setOpenNote] = useState<string | null>(null);

  const updateQuestion = (id: string, patch: Partial<JudgeQuestion>) =>
    setQuestions((previous) =>
      previous.map((question) => (question.id === id ? { ...question, ...patch } : question)),
    );

  const addCustomQuestion = async () => {
    const text = custom.trim();
    if (text.length < 8) return;
    const question: JudgeQuestion = {
      id: `judge.${Date.now().toString(36)}`,
      category: "product",
      question: text,
      why: "Added by you, not generated from the evidence.",
      evidence: "Judge-authored question.",
      priority: "medium",
      source: "judge",
      status: "pending",
      note: null,
    };
    const next = [...questions, question];
    setQuestions(next);
    setCustom("");
    await onSaveQuestions(next);
  };

  const removeQuestion = async (id: string) => {
    const next = questions.filter((question) => question.id !== id);
    setQuestions(next);
    await onSaveQuestions(next);
  };

  const pending = questions.filter((question) => question.status === "pending").length;

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------- questions to ask */}
      <section className="surface space-y-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <CircleHelp className="h-4 w-4" aria-hidden />
              Questions to ask
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {questions.length === 0
                ? "Nothing in the analysis needs a question — the evidence either supports the claims or the sources were unreadable."
                : `${questions.length} question${questions.length === 1 ? "" : "s"} from the evidence${pending > 0 ? ` · ${pending} not asked yet` : ""}`}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => void onSaveQuestions(questions)}
          >
            <Save className="h-3.5 w-3.5" />
            Save question state
          </Button>
        </div>

        {questions.length === 0 && (
          <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-xs text-muted-foreground">
            BuildLens asks nothing when there is nothing to verify. Add your own question below if
            something is worth probing.
          </p>
        )}

        <ul className="space-y-3">
          {questions.map((question) => (
            <li key={question.id} className="rounded-lg border border-border/70 bg-card/40 p-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className={cn("text-[10px]", PRIORITY_TONE[question.priority])}>
                  {question.priority}
                </Badge>
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  {question.category}
                </Badge>
                <Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[question.status])}>
                  {question.status}
                </Badge>
                {question.source === "judge" && (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    yours
                  </Badge>
                )}
                {question.source === "judge" && (
                  <button
                    type="button"
                    onClick={() => void removeQuestion(question.id)}
                    className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                    Remove
                  </button>
                )}
              </div>

              <p className="mt-2 text-sm font-medium leading-relaxed text-foreground/90">
                {question.question}
              </p>

              <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground/70">Why ask this:</span>{" "}
                  {question.why}
                </p>
                <p>
                  <span className="font-medium text-foreground/70">Evidence:</span>{" "}
                  {question.evidence}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={question.status === "asked" ? "default" : "outline"}
                  disabled={saving}
                  onClick={() => {
                    const next = questions.map((entry) =>
                      entry.id === question.id ? { ...entry, status: "asked" as const } : entry,
                    );
                    setQuestions(next);
                    void onSaveQuestions(next);
                  }}
                >
                  <Check className="h-3.5 w-3.5" />
                  Mark as asked
                </Button>
                <Button
                  size="sm"
                  variant={question.status === "answered" ? "default" : "outline"}
                  disabled={saving}
                  onClick={() => {
                    const next = questions.map((entry) =>
                      entry.id === question.id ? { ...entry, status: "answered" as const } : entry,
                    );
                    setQuestions(next);
                    void onSaveQuestions(next);
                  }}
                >
                  <BadgeCheck className="h-3.5 w-3.5" />
                  Answered
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setOpenNote(openNote === question.id ? null : question.id)}
                >
                  <MessageSquarePlus className="h-3.5 w-3.5" />
                  {question.note ? "Edit note" : "Add note"}
                </Button>
              </div>

              {(openNote === question.id || question.note) && (
                <Textarea
                  className="mt-2 min-h-16 text-xs"
                  aria-label={`Note for: ${question.question}`}
                  placeholder="What did the team answer?"
                  value={question.note ?? ""}
                  onChange={(event) => updateQuestion(question.id, { note: event.target.value })}
                />
              )}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-end gap-2 border-t border-border/70 pt-4">
          <div className="min-w-56 flex-1">
            <label
              htmlFor="custom-question"
              className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
            >
              Your own question
            </label>
            <Input
              id="custom-question"
              className="mt-1"
              placeholder="e.g. Where does the local CV parsing run?"
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={saving || custom.trim().length < 8}
            onClick={() => void addCustomQuestion()}
          >
            <Plus className="h-3.5 w-3.5" />
            Add question
          </Button>
        </div>
      </section>

      {/* ------------------------------------------------------ judge review */}
      <section className="surface space-y-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <ListChecks className="h-4 w-4" aria-hidden />
              Judge review
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Stored with this submission. Candidates never see this section.
            </p>
          </div>
          <Button
            size="sm"
            disabled={saving}
            onClick={() =>
              void onSaveReview({ ...review, updatedAt: new Date().toISOString() })
            }
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving…" : "Save review"}
          </Button>
        </div>

        <div>
          <label
            htmlFor="review-assessment"
            className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
          >
            Overall assessment
          </label>
          <Textarea
            id="review-assessment"
            className="mt-1 min-h-24"
            placeholder="What did you see, and how much of it held up?"
            value={review.assessment}
            onChange={(event) => setReview((previous) => ({ ...previous, assessment: event.target.value }))}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <ListEditor
            label="Strengths"
            items={review.strengths}
            placeholder="What the project genuinely does well"
            onChange={(strengths) => setReview((previous) => ({ ...previous, strengths }))}
          />
          <ListEditor
            label="Weaknesses"
            items={review.weaknesses}
            placeholder="What did not hold up"
            onChange={(weaknesses) => setReview((previous) => ({ ...previous, weaknesses }))}
          />
          <ListEditor
            label="Suggestions"
            items={review.suggestions}
            placeholder="What the team should do next"
            onChange={(suggestions) => setReview((previous) => ({ ...previous, suggestions }))}
          />
          <ListEditor
            label="Additional concerns"
            items={review.concerns}
            placeholder="Anything the evidence did not cover"
            onChange={(concerns) => setReview((previous) => ({ ...previous, concerns }))}
          />
        </div>

        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Final recommendation
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {RECOMMENDATIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={review.recommendation === value}
                onClick={() => setReview((previous) => ({ ...previous, recommendation: value }))}
                className={cn(
                  "rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                  review.recommendation === value
                    ? "border-primary/30 bg-primary/[0.09] text-foreground"
                    : "border-border/70 text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {review.updatedAt && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Sparkles className="h-3 w-3" aria-hidden />
            Last saved {new Date(review.updatedAt).toLocaleString()}
          </p>
        )}
      </section>
    </div>
  );
}

function ListEditor({
  label,
  items,
  placeholder,
  onChange,
}: {
  label: string;
  items: string[];
  placeholder: string;
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (!value) return;
    onChange([...items, value]);
    setDraft("");
  };
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      {items.length === 0 ? (
        <p className="mt-1 text-[11px] italic text-muted-foreground">Nothing added yet.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {items.map((item, index) => (
            <li key={`${label}-${index}`} className="flex items-start gap-1.5 text-xs">
              <span className="min-w-0 flex-1 leading-relaxed text-foreground/85">{item}</span>
              <button
                type="button"
                aria-label={`Remove ${item}`}
                onClick={() => onChange(items.filter((_, position) => position !== index))}
                className="mt-0.5 text-muted-foreground transition-colors hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1.5 flex gap-1.5">
        <Input
          className="h-8 text-xs"
          placeholder={placeholder}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button size="sm" variant="outline" className="h-8" onClick={add} disabled={!draft.trim()}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
