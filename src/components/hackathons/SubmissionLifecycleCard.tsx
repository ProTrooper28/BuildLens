import { CalendarClock, Eye, Lock, Trophy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  SUBMISSION_LIFECYCLE,
  candidateStatusLabel,
  lifecycleStage,
} from "@/services/hackathon.service";
import type { Hackathon, HackathonSubmission } from "@/types/hackathon";
import { cn } from "@/lib/utils";

/**
 * What a candidate is allowed to know about their own submission.
 *
 * The lifecycle is the shared one both portals use (`SUBMISSION_LIFECYCLE`), so a
 * status a judge sees in their portal reads the same here. Scores, notes and AI
 * reasoning never appear: until a judge publishes a result the card says only that
 * they are private.
 */
export function SubmissionLifecycleCard({
  hackathon,
  submission,
}: {
  hackathon: Hackathon;
  submission: HackathonSubmission;
}) {
  const stage = lifecycleStage(submission.status);
  const result = submission.resultPublished ? submission.publishedResult : null;
  const submittedOn = new Date(submission.submittedAt);

  return (
    <article className="surface flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{submission.teamName}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {hackathon.name} · <span className="font-mono">{hackathon.code}</span>
          </p>
        </div>
        <Badge variant="outline" className="shrink-0">
          {candidateStatusLabel(submission.status)}
        </Badge>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarClock className="h-3.5 w-3.5" aria-hidden />
        Submitted {submittedOn.toLocaleDateString()}
      </div>

      <ol className="space-y-1.5" aria-label="Submission progress">
        {SUBMISSION_LIFECYCLE.map((step, index) => {
          const position = index + 1;
          const done = position < stage;
          const current = position === stage;
          return (
            <li key={step.key} className="flex items-center gap-2 text-xs">
              <span
                aria-hidden
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  done && "bg-success",
                  current && "bg-primary ring-2 ring-primary/20",
                  !done && !current && "bg-muted",
                )}
              />
              <span
                className={cn(
                  done && "text-muted-foreground",
                  current && "font-medium text-foreground",
                  !done && !current && "text-muted-foreground/70",
                )}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>

      {result ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-success/25 bg-success/[0.06] px-3 py-2.5 text-sm">
          <span className="inline-flex items-center gap-1.5 font-medium text-success">
            <Trophy className="h-3.5 w-3.5" aria-hidden /> Result published
          </span>
          <span className="tabular-nums">
            {round1(result.total)} / {result.maxScore}
            <span className="ml-1 text-xs text-muted-foreground">({round1(result.percent)}%)</span>
          </span>
          {result.rank ? (
            <span className="text-xs text-muted-foreground">Rank #{result.rank}</span>
          ) : null}
        </div>
      ) : (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          {submission.status === "finalized" ? (
            <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          ) : (
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          )}
          Judge scores and notes stay private until the organizers publish a result.
        </p>
      )}

      {submission.repoUrl || submission.websiteUrl ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {submission.repoUrl ? (
            <a
              href={submission.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate hover:text-foreground hover:underline"
            >
              Repository
            </a>
          ) : null}
          {submission.websiteUrl ? (
            <a
              href={submission.websiteUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate hover:text-foreground hover:underline"
            >
              Live site
            </a>
          ) : null}
          {submission.deckName ? (
            <span className="truncate">Deck: {submission.deckName}</span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
