import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Circle, Lock, RefreshCw, Trophy } from "lucide-react";

import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCandidateStatus } from "@/hooks/useHackathonPortal";
import type { SubmissionCheck, SubmissionStep } from "@/services/portal.service";
import { cn } from "@/lib/utils";

/**
 * What the candidate sees right after submitting — and later.
 *
 * Deliberately brief: the project, the hackathon, the lifecycle and a short
 * submission check. No judge score, no notes, no ranking and no analysis detail;
 * those exist on the judge side. The only evaluation number that can appear here
 * is a result an organizer explicitly published.
 */

const CHECK_TONE: Record<SubmissionCheck["state"], { glyph: string; className: string }> = {
  ok: { glyph: "✓", className: "text-success" },
  warn: { glyph: "⚠", className: "text-warning" },
  unknown: { glyph: "·", className: "text-muted-foreground" },
};

const STEP_TONE: Record<SubmissionStep["state"], { dot: string; text: string }> = {
  done: { dot: "bg-success", text: "text-muted-foreground" },
  active: { dot: "bg-primary ring-2 ring-primary/20", text: "font-medium text-foreground" },
  pending: { dot: "bg-muted", text: "text-muted-foreground/70" },
  unavailable: { dot: "bg-muted", text: "text-muted-foreground/70" },
};

export function SubmissionStatusPage({ submissionId }: { submissionId: string }) {
  const query = useCandidateStatus(submissionId);
  const notice = query.data ? null : query.isLoading ? null : "We couldn't load this submission.";

  if (query.isLoading) {
    return (
      <AppLayout title="Loading submission" crumbs={[{ label: "Dashboard", to: "/dashboard" }]}>
        <div className="space-y-4">
          <div className="h-32 animate-pulse rounded-xl border border-border/70 bg-card/40" />
          <div className="h-56 animate-pulse rounded-xl border border-border/70 bg-card/30" />
        </div>
      </AppLayout>
    );
  }

  const data = query.data ?? null;
  if (!data) {
    return (
      <AppLayout title="Submission not found" crumbs={[{ label: "Dashboard", to: "/dashboard" }]}>
        <div className="mx-auto max-w-lg rounded-xl border border-border/70 bg-card/40 px-6 py-12 text-center">
          <AlertTriangle className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="mt-3 text-sm font-medium">
            {notice ?? "This submission is not available."}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Guest submissions live in this browser. If local storage was cleared or you opened this
            link on another device, it can't be recovered — submit the project again with the same
            hackathon code.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to="/review/project">Submit a project</Link>
          </Button>
        </div>
      </AppLayout>
    );
  }

  const { submission, hackathon, projectName, statusLabel, checks, steps, result } = data;

  return (
    <AppLayout
      title="Submission received"
      subtitle={`${hackathon.name} · ${hackathon.code}`}
      crumbs={[{ label: "Dashboard", to: "/dashboard" }, { label: projectName }]}
      actions={
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      }
    >
      <div className="mx-auto max-w-3xl space-y-4">
        <section className="surface p-6">
          <div className="flex items-start gap-4">
            <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-success/10 text-success">
              <CheckCircle2 className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold tracking-tight">SUBMISSION RECEIVED ✓</h1>
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    Project
                  </dt>
                  <dd className="mt-0.5 font-medium">{projectName}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    Team
                  </dt>
                  <dd className="mt-0.5">{submission.teamName}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    Hackathon
                  </dt>
                  <dd className="mt-0.5">
                    {hackathon.name}{" "}
                    <span className="font-mono text-xs text-muted-foreground">
                      {hackathon.code}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    Status
                  </dt>
                  <dd className="mt-0.5">
                    <Badge variant="outline" className="text-[11px]">
                      {statusLabel}
                    </Badge>
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                Submitted {new Date(submission.submittedAt).toLocaleString()}. Your submission is
                already in the judges' portal — nothing else to send.
              </p>
            </div>
          </div>
        </section>

        {result ? (
          <section className="surface flex flex-wrap items-center gap-x-5 gap-y-2 border-success/25 p-5">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-success">
              <Trophy className="h-4 w-4" aria-hidden /> Result published
            </span>
            <span className="font-mono text-sm tabular-nums">
              {Math.round(result.total * 10) / 10} / {result.maxScore}
              <span className="ml-1 text-xs text-muted-foreground">
                ({Math.round(result.percent * 10) / 10}%)
              </span>
            </span>
            {result.rank ? (
              <span className="text-xs text-muted-foreground">Rank #{result.rank}</span>
            ) : null}
          </section>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <section className="surface p-5">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Submission check
            </h2>
            <ul className="mt-3 space-y-2.5">
              {checks.map((check) => {
                const tone = CHECK_TONE[check.state];
                return (
                  <li key={check.key} className="flex items-start gap-2.5">
                    <span className={cn("mt-0.5 w-4 shrink-0 text-sm", tone.className)} aria-hidden>
                      {tone.glyph}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm">{check.label}</p>
                      <p className="text-xs text-muted-foreground">{check.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="surface p-5">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Progress
            </h2>
            <ol className="mt-3 space-y-2.5">
              {steps.map((step) => {
                const tone = STEP_TONE[step.state];
                return (
                  <li key={step.key} className="flex items-start gap-2.5">
                    <span
                      className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className={cn("text-sm", tone.text)}>{step.label}</p>
                      <p className="text-xs text-muted-foreground">{step.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
              {result ? (
                <Circle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              ) : (
                <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              )}
              {result
                ? "The organizers published your result. Judge notes stay private."
                : "Judge scores, notes and rankings stay private until the organizers publish a result."}
            </p>
          </section>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/review/project">Submit another project</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
