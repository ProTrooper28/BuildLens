import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Copy,
  Hash,
  RefreshCw,
  Ticket,
  TriangleAlert,
  Users,
} from "lucide-react";

import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useJudgeWorkspace } from "@/hooks/useHackathonPortal";
import { portalStorageNotice, submissionStatusLabel } from "@/services/hackathon.service";
import type { JudgeSubmissionRow } from "@/services/portal.service";
import { notify } from "@/lib/toast-messages";
import { cn } from "@/lib/utils";

/**
 * One hackathon's judging workspace — the organizer's main screen.
 *
 * Every row is a `hackathon_submissions` record a candidate created with this
 * code: nothing is imported, copied or re-keyed here. Opening a row leads to the
 * shared project page, which reads the same record and its analysis report.
 */

const READINESS: Record<JudgeSubmissionRow["analysis"], { label: string; className: string }> = {
  ready: { label: "Analysis ready", className: "border-success/30 bg-success/10 text-success" },
  running: { label: "Analysis running", className: "border-warning/30 bg-warning/10 text-warning" },
  failed: {
    label: "Analysis failed",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  not_started: { label: "Waiting for analysis", className: "text-muted-foreground" },
};

function actionLabel(row: JudgeSubmissionRow): string {
  if (row.judgeScore !== null) return "Open evaluation";
  if (row.analysis === "ready") return "Review";
  return "View status";
}

function scoreText(score: number | null, max: number | null): string {
  if (score === null) return "—";
  return max === null ? String(score) : `${score}/${max}`;
}

export function RealHackathonWorkspace({ code }: { code: string }) {
  const workspace = useJudgeWorkspace(code);
  const notice = portalStorageNotice();

  const copyCode = (value: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => notify.copied("hackathon code"),
      () => notify.info("Hackathon code", value),
    );
  };

  if (workspace.isLoading) {
    return (
      <AppLayout title="Loading workspace" crumbs={[{ label: "Hackathons", to: "/hackathons" }]}>
        <div className="space-y-4">
          <div className="h-24 animate-pulse rounded-xl border border-border/70 bg-card/40" />
          <div className="h-64 animate-pulse rounded-xl border border-border/70 bg-card/30" />
        </div>
      </AppLayout>
    );
  }

  if (workspace.isError) {
    return (
      <AppLayout
        title="Workspace unavailable"
        crumbs={[{ label: "Hackathons", to: "/hackathons" }]}
      >
        <div className="rounded-xl border border-destructive/30 bg-destructive/[0.06] px-5 py-6 text-sm text-destructive">
          This hackathon could not be loaded.{" "}
          {workspace.error instanceof Error ? workspace.error.message : null}
        </div>
      </AppLayout>
    );
  }

  const data = workspace.data ?? null;
  if (!data) {
    return (
      <AppLayout title="Hackathon not found" crumbs={[{ label: "Hackathons", to: "/hackathons" }]}>
        <div className="rounded-xl border border-border/70 bg-card/40 px-6 py-14 text-center">
          <Ticket className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="mt-3 text-sm font-medium">No hackathon matches {code}.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Codes are not case-sensitive. Check the code with the organizer, or create the hackathon
            from the archives page first.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to="/hackathons">Back to hackathons</Link>
          </Button>
        </div>
      </AppLayout>
    );
  }

  const { hackathon, rows, counts } = data;

  return (
    <AppLayout
      title={hackathon.name}
      subtitle={`${hackathon.code} · ${hackathon.criteria.length} criteria · ${hackathon.maxScore} points`}
      crumbs={[{ label: "Hackathons", to: "/hackathons" }, { label: hackathon.name }]}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => copyCode(hackathon.code)}
            title="Copy join code"
            aria-label={`Copy join code ${hackathon.code}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2.5 py-1 font-mono text-xs tracking-[0.14em] transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {hackathon.code}
            <Copy className="h-3 w-3" aria-hidden />
          </button>
          <Button variant="outline" size="sm" onClick={() => void workspace.refetch()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Link
          to="/hackathons"
          className="group inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" />
          All hackathons
        </Link>

        {notice ? (
          <p className="rounded-lg border border-warning/30 bg-warning/[0.07] px-4 py-2.5 text-xs text-warning">
            {notice.text}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: ClipboardList,
              label: "Submissions",
              value: counts.submissions,
              hint: "Submitted with this code",
            },
            {
              icon: CheckCircle2,
              label: "Evaluated",
              value: counts.evaluated,
              hint: "A judge score is stored",
            },
            {
              icon: Hash,
              label: "Pending",
              value: counts.pending,
              hint: "Analysis still running",
            },
            {
              icon: TriangleAlert,
              label: "Needs review",
              value: counts.needsReview,
              hint: "Analysis ready, not scored",
            },
          ].map((stat) => (
            <div key={stat.label} className="surface p-4">
              <p className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <stat.icon className="h-3.5 w-3.5" aria-hidden /> {stat.label}
              </p>
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{stat.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{stat.hint}</p>
            </div>
          ))}
        </div>

        <section className="surface p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3 pt-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Projects
            </h2>
            <span className="text-xs text-muted-foreground">
              {hackathon.startsAt || hackathon.endsAt
                ? `${hackathon.startsAt ? new Date(hackathon.startsAt).toLocaleDateString() : "—"} → ${hackathon.endsAt ? new Date(hackathon.endsAt).toLocaleDateString() : "—"}`
                : "No dates set"}
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="border-t border-border/60 px-5 py-10 text-center">
              <Users className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden />
              <p className="mt-2 text-sm font-medium">No submissions yet.</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Candidates join with the code{" "}
                <span className="font-mono text-foreground">{hackathon.code}</span>. Anything they
                submit lands here automatically — no import step.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] border-collapse text-sm">
                <thead>
                  <tr className="border-y border-border/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-2 font-semibold">Project</th>
                    <th className="px-3 py-2 font-semibold">Team</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">AI score</th>
                    <th className="px-3 py-2 text-right font-semibold">Judge score</th>
                    <th className="px-3 py-2 text-right font-semibold">Final</th>
                    <th className="px-5 py-2 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const readiness = READINESS[row.analysis];
                    return (
                      <tr
                        key={row.submission.id}
                        className="border-b border-border/40 last:border-0"
                      >
                        <td className="px-5 py-3">
                          <Link
                            to="/hackathons/$code/project/$projectId"
                            params={{ code: hackathon.code, projectId: row.submission.id }}
                            search={{ view: "projects" }}
                            className="font-medium hover:underline"
                          >
                            {row.projectName ?? row.submission.teamName}
                          </Link>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {submissionStatusLabel(row.submission.status)} ·{" "}
                            {new Date(row.submission.submittedAt).toLocaleDateString()}
                          </p>
                        </td>
                        <td className="px-3 py-3 text-sm">{row.submission.teamName}</td>
                        <td className="px-3 py-3">
                          <Badge
                            variant="outline"
                            className={cn("text-[11px] font-normal", readiness.className)}
                          >
                            {readiness.label}
                          </Badge>
                          {row.judgeDraft ? (
                            <p className="mt-1 text-[11px] text-warning">Draft saved</p>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums">
                          {row.aiScore === null ? "—" : `${row.aiScore}/100`}
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums">
                          {scoreText(row.judgeScore, row.judgeMax)}
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums">
                          {scoreText(row.finalScore, row.finalScore === null ? null : row.finalMax)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <Button asChild variant="outline" size="sm">
                            <Link
                              to="/hackathons/$code/project/$projectId"
                              params={{ code: hackathon.code, projectId: row.submission.id }}
                              search={{ view: "projects" }}
                            >
                              {actionLabel(row)} <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppLayout>
  );
}
