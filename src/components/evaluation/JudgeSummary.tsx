import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  HelpCircle,
  Loader2,
  MinusCircle,
  RefreshCw,
  ScanSearch,
  Sparkles,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineSkeletons } from "@/components/state/skeletons";
import { VerdictToneBadge } from "@/components/evaluation/inspection-ui";
import { ClaimVerification } from "@/components/evaluation/ClaimVerification";
import { AttentionSummary, JudgeAttention } from "@/components/evaluation/JudgeAttention";
import type { EvidencePhase } from "@/hooks/useEvidenceRun";
import { cn } from "@/lib/utils";
import type { InspectionReport } from "@/services/inspection/types";

/**
 * Judge summary — the default screen.
 *
 * Structure follows the order a judge actually thinks in:
 *
 *   EXECUTIVE SUMMARY   what the verdict is and why the score moved
 *   CANDIDATE-PROVIDED  what the team states about itself (never verified)
 *   JUDGE ATTENTION     the few grouped, risk-ranked issues that need a human
 *   CLAIM VERIFICATION  every claim → source → repository → live app → verdict
 *   WHAT WAS READ       what the team claims, what was verified, what was not
 *
 * Every statement comes from the deterministic inspection report; this component
 * never summarises on its own and never invents a finding.
 */

export interface JudgeSummaryProps {
  submissionId: string;
  report: InspectionReport | null;
  phase: EvidencePhase;
  /** Bundle exists but the AI stage failed — findings are still complete. */
  partial: boolean;
  error: string | null;
  starting: boolean;
  onStart: () => void;
}

function CountChip({
  icon: Icon,
  count,
  label,
  className,
}: {
  icon: typeof CheckCircle2;
  count: number;
  label: string;
  className: string;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="tabular-nums">{count}</span>
      <span className="font-normal">{label}</span>
    </li>
  );
}

function ListBlock({
  title,
  items,
  empty,
  limit = 3,
  icon: Icon,
  iconClassName,
}: {
  title: string;
  items: string[];
  empty: string;
  limit?: number;
  icon: typeof CheckCircle2;
  iconClassName: string;
}) {
  const shown = items.slice(0, limit);
  return (
    <div className="min-w-0">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {shown.length === 0 ? (
        <p className="mt-1.5 text-xs italic text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {shown.map((item, index) => (
            <li
              key={`${item}-${index}`}
              className="flex gap-1.5 text-xs leading-snug text-foreground/85"
            >
              <Icon className={cn("mt-0.5 h-3 w-3 shrink-0", iconClassName)} aria-hidden />
              <span className="min-w-0">{item}</span>
            </li>
          ))}
          {items.length > shown.length && (
            <li className="text-[11px] text-muted-foreground">
              +{items.length - shown.length} more in the detailed analysis
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export function JudgeSummary({
  submissionId,
  report,
  phase,
  partial,
  error,
  starting,
  onStart,
}: JudgeSummaryProps) {
  const running = phase === "starting" || phase === "running";
  const verdict = report?.verdict ?? null;
  const navigate = useNavigate();

  return (
    <Card
      id="judge-summary"
      className="scroll-mt-24 overflow-hidden border-border/70 bg-card/60 backdrop-blur"
    >
      {/* Existing "Why?" links in the scoring panel point at this anchor. */}
      <span id="evidence-section" aria-hidden />
      <CardHeader className="flex-row items-start justify-between gap-3 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            Overall project verdict
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {verdict
              ? `${verdict.projectTypeLabel} · inspected automatically from the deck, repository and deployment.`
              : "BuildLens inspects the deck, repository and deployed app, then checks every claim against what it read."}
          </p>
        </div>
        {verdict && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {verdict.score !== null && (
              <Badge variant="outline" className="border-border tabular-nums text-muted-foreground">
                {verdict.score}/100
              </Badge>
            )}
            <VerdictToneBadge tone={verdict.tone} label={verdict.toneLabel} />
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-6 pt-4">
        {running && (
          <div className="space-y-3" aria-live="polite">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Inspecting the deck, repository and deployed application…
            </div>
            <LineSkeletons rows={4} />
            <p className="text-[11px] text-muted-foreground">
              This only reads public sources. Your scores are never changed by it.
            </p>
          </div>
        )}

        {!running && !verdict && (
          <div
            role={phase === "error" ? "alert" : undefined}
            className={cn(
              "rounded-lg border px-3 py-5 text-center",
              phase === "error"
                ? "border-destructive/30 bg-destructive/[0.06]"
                : "border-dashed border-border/70",
            )}
          >
            <ScanSearch
              className={cn(
                "mx-auto h-5 w-5",
                phase === "error" ? "text-destructive" : "text-muted-foreground",
              )}
              aria-hidden
            />
            <p className="mt-2 text-sm font-medium">
              {phase === "error" ? "Could not verify this submission" : "Inspection not started"}
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              {phase === "error"
                ? (error ??
                  "The inspection could not be completed, so nothing was verified. That is a gap in the evidence, not a negative finding.")
                : "Start the inspection to read the deck, repository and deployed app and check the team's claims against them."}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" variant="outline" onClick={onStart} disabled={starting}>
                {starting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {phase === "error" ? "Try again" : "Start inspection"}
              </Button>
              {/* The technical page must be reachable even when nothing was read:
                  it explains each source that failed. */}
              <Button size="sm" variant="ghost" asChild>
                <Link to="/evaluation/project/$id/analysis" params={{ id: submissionId }}>
                  View Detailed Analysis
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </Button>
            </div>
          </div>
        )}

        {!running && report && verdict && (
          <>
            {/* 1. EXECUTIVE SUMMARY */}
            <section id="executive-summary" className="scroll-mt-24 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Executive summary
                </h2>
                <AttentionSummary counts={verdict.severityCounts} />
              </div>
              <p className="text-base font-semibold leading-snug">{verdict.headline}</p>
              <p className="text-xs text-muted-foreground">{verdict.strategy}</p>

              <ul className="flex flex-wrap gap-1.5 pt-1">
                <CountChip
                  icon={CheckCircle2}
                  count={verdict.counts.supported}
                  label="supported"
                  className="border-success/30 bg-success/10 text-success"
                />
                <CountChip
                  icon={CircleDashed}
                  count={verdict.counts.partially_supported}
                  label="partially supported"
                  className="border-warning/30 bg-warning/10 text-warning"
                />
                <CountChip
                  icon={MinusCircle}
                  count={verdict.counts.not_found}
                  label="not found"
                  className="border-border bg-muted/60 text-muted-foreground"
                />
                <CountChip
                  icon={HelpCircle}
                  count={verdict.counts.could_not_verify}
                  label="could not be verified"
                  className="border-primary/25 bg-primary/[0.07] text-primary"
                />
              </ul>

              {verdict.dimensions.length > 0 && (
                <ul className="space-y-1 pt-1">
                  {verdict.dimensions.slice(0, 4).map((dimension) => (
                    <li
                      key={dimension.id}
                      className="flex flex-wrap items-baseline gap-x-2 text-[11px] leading-snug"
                    >
                      <span className="font-medium text-foreground/85">{dimension.label}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {dimension.score === null ? "not scored" : `${dimension.score}/100`}
                      </span>
                      <span className="min-w-0 flex-1 text-muted-foreground">{dimension.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Candidate metadata: reported, never verified. */}
            {verdict.candidateProvided.length > 0 && (
              <section id="candidate-provided" className="scroll-mt-24">
                <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Candidate-provided
                </h2>
                <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
                  {verdict.candidateProvided.map((fact) => (
                    <li
                      key={`${fact.label}-${fact.value}`}
                      className="flex flex-wrap items-baseline gap-x-1.5 text-xs"
                    >
                      <span className="text-muted-foreground">{fact.label}:</span>
                      <span className="font-medium text-foreground/90">{fact.value}</span>
                      <span className="text-[10px] text-muted-foreground/70">({fact.source})</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Stated by the candidate. BuildLens did not verify these details and does not
                  count them as claims.
                </p>
              </section>
            )}

            {/* 2. JUDGE ATTENTION — grouped, severity-ranked. Each finding links
                to the exact section that holds its evidence. */}
            <JudgeAttention
              findings={verdict.attention}
              onNavigate={(section) =>
                void navigate({
                  to: "/evaluation/project/$id/analysis",
                  params: { id: submissionId },
                  hash: `section-${section}`,
                })
              }
            />

            {/* 3. CLAIM VERIFICATION — claim → source → repository → app → verdict */}
            <ClaimVerification claims={verdict.claimsTable} counts={verdict.verdictCounts} />

            {/* 4. WHAT WAS READ */}
            <div className="grid gap-4 sm:grid-cols-2">
              <ListBlock
                title="What the team claims"
                items={verdict.claimed}
                empty="No checkable claims were submitted."
                icon={Sparkles}
                iconClassName="text-muted-foreground"
              />
              <ListBlock
                title="What BuildLens verified"
                items={verdict.verified}
                empty="Nothing could be fully verified from the readable sources."
                icon={CheckCircle2}
                iconClassName="text-success"
              />
              <ListBlock
                title="Could not be verified"
                items={verdict.unverified}
                empty="Every checked claim was backed by evidence."
                icon={HelpCircle}
                iconClassName="text-primary"
              />
              <ListBlock
                title="Important strengths"
                items={verdict.strengths}
                empty="No strength was recorded yet."
                icon={CheckCircle2}
                iconClassName="text-success"
              />
            </div>

            {verdict.findings.some((finding) =>
              ["low", "info"].includes(finding.severity),
            ) && (
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Minor observations
                </h3>
                <ul className="mt-1.5 space-y-1">
                  {verdict.findings
                    .filter((finding) => finding.severity === "low")
                    .slice(0, 4)
                    .map((finding) => (
                      <li key={finding.id} className="flex gap-1.5 text-xs leading-snug text-foreground/80">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0">{finding.title}</span>
                      </li>
                    ))}
                </ul>
              </div>
            )}

            <div className="rounded-lg border border-primary/20 bg-primary/[0.04] p-3">
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-primary">
                What the judge should know
              </h3>
              <ul className="mt-2 space-y-1.5">
                {verdict.judgeBullets.map((bullet, index) => (
                  <li
                    key={`${bullet}-${index}`}
                    className="text-sm leading-snug text-foreground/90"
                  >
                    {bullet}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button asChild size="sm">
                <Link
                  to="/evaluation/project/$id/analysis"
                  params={{ id: submissionId }}
                  className="gap-1.5"
                >
                  View Detailed Analysis
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </Button>
              <Button variant="outline" size="sm" onClick={onStart} disabled={starting}>
                {starting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Re-run inspection
              </Button>
              <Badge variant="outline" className="ml-auto border-border text-[11px] text-muted-foreground">
                {verdict.aiAvailable ? "AI analysis included" : "No AI analysis — evidence only"}
              </Badge>
            </div>

            {verdict.missingInputs.length > 0 && (
              <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
                <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden />
                {verdict.missingInputs.join(" ")}
              </p>
            )}
            <p className="text-[11px] leading-snug text-muted-foreground">{report.disclaimer}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
