import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  FileText,
  GitBranch,
  Globe,
  HelpCircle,
  Loader2,
  MinusCircle,
  RefreshCw,
  ScanSearch,
  Sparkles,
  XCircle,
} from "lucide-react";

import { BrandMark } from "@/components/brand/BrandLogo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeading } from "@/components/evaluation/shared";
import { LineSkeletons } from "@/components/state/skeletons";
import { useEvidenceRun } from "@/hooks/useEvidenceRun";
import { cn } from "@/lib/utils";
import type { EvaluationRun } from "@/services/evaluation-agent/schema";
import {
  CLAIM_STATUS_LABELS,
  type ClaimEvidenceStatus,
  type ClaimCheck,
  type EvidenceBundle,
} from "@/services/evidence/types";
import type { SubmissionDetail } from "@/types/evaluation";
import type { EvidencePhase } from "@/hooks/useEvidenceRun";

/**
 * Evidence section.
 *
 * The judge-facing "why": every source that was read (or could not be), every
 * claim with its status, and the AI's structured closing summary. Presentational
 * `EvidencePanel` plus a container that owns the run so the states can be
 * rendered (and tested) independently of the network.
 */

const STATUS_STYLE: Record<ClaimEvidenceStatus, { icon: typeof CheckCircle2; className: string }> =
  {
    supported: { icon: CheckCircle2, className: "border-success/30 bg-success/10 text-success" },
    partially_supported: {
      icon: CircleDashed,
      className: "border-warning/30 bg-warning/10 text-warning",
    },
    not_found: { icon: MinusCircle, className: "border-border bg-muted/60 text-muted-foreground" },
    could_not_verify: {
      icon: HelpCircle,
      className: "border-primary/25 bg-primary/[0.07] text-primary",
    },
  };

const SOURCE_ICON = {
  repository: GitBranch,
  website: Globe,
  document: FileText,
  submission: ScanSearch,
} as const;

export function ClaimStatusBadge({ status }: { status: ClaimEvidenceStatus }) {
  const { icon: Icon, className } = STATUS_STYLE[status];
  return (
    <Badge variant="outline" className={cn("shrink-0 gap-1", className)}>
      <Icon className="h-3 w-3" aria-hidden />
      {CLAIM_STATUS_LABELS[status]}
    </Badge>
  );
}

function ClaimRow({ check }: { check: ClaimCheck }) {
  return (
    <li className="rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-medium leading-snug">{check.claim}</p>
        <ClaimStatusBadge status={check.status} />
      </div>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">{check.note}</p>
      {((check.pageRefs?.length ?? 0) > 0 || (check.evidenceRefs?.length ?? 0) > 0) && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {(check.pageRefs ?? []).map((page) => (
            <li
              key={`page-${page}`}
              className="rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] leading-tight text-muted-foreground"
            >
              Deck page {page}
            </li>
          ))}
          {(check.evidenceRefs ?? []).map((ref) => (
            <li
              key={ref}
              className="rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] leading-tight text-muted-foreground"
            >
              {ref}
            </li>
          ))}
        </ul>
      )}
      {check.quotes.length > 0 && (
        <ul className="mt-2 space-y-1 border-l-2 border-primary/20 pl-2.5">
          {check.quotes.map((quote) => (
            <li key={quote} className="text-[11px] italic leading-snug text-foreground/80">
              “{quote}”
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function SourceRow({ source }: { source: EvidenceBundle["sources"][number] }) {
  const Icon = SOURCE_ICON[source.kind];
  return (
    <li className="rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">{source.label}</p>
        <Badge
          variant="outline"
          className={cn(
            "ml-auto",
            source.readable
              ? "border-success/30 bg-success/10 text-success"
              : "border-warning/30 bg-warning/10 text-warning",
          )}
        >
          {source.readable ? "Read" : "Gap"}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{source.detail}</p>
      {source.highlights.length > 0 && (
        <ul className="mt-2 space-y-1">
          {source.highlights.slice(0, 6).map((highlight) => (
            <li
              key={highlight}
              className="flex gap-1.5 text-[11px] leading-snug text-foreground/80"
            >
              <span
                className="mt-1 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60"
                aria-hidden
              />
              {highlight}
            </li>
          ))}
        </ul>
      )}
      {source.url && (
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-2 inline-block truncate text-[11px] text-primary hover:underline"
        >
          {source.url}
        </a>
      )}
    </li>
  );
}

function FinalSummary({ bundle, run }: { bundle: EvidenceBundle; run: EvaluationRun }) {
  const summary = run.result?.finalSummary;
  const claims = run.result?.claimChecks ?? [];
  if (!summary) return null;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
        <SectionHeading>Overall AI verdict</SectionHeading>
        <p className="mt-1 text-sm leading-relaxed">{summary.verdict}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <SectionHeading>Project understanding</SectionHeading>
          <p className="mt-1 text-xs leading-relaxed text-foreground/85">
            {summary.projectUnderstanding}
          </p>
        </div>
        <div>
          <SectionHeading>Technical assessment</SectionHeading>
          <p className="mt-1 text-xs leading-relaxed text-foreground/85">
            {summary.technicalAssessment}
          </p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <SectionHeading>Strongest evidence</SectionHeading>
          {summary.strongestEvidence.length === 0 ? (
            <p className="mt-1 text-xs italic text-muted-foreground">
              No evidence-backed strength was recorded.
            </p>
          ) : (
            <ul className="mt-1 space-y-1">
              {summary.strongestEvidence.map((item) => (
                <li key={item} className="flex gap-1.5 text-xs text-foreground/85">
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <SectionHeading>Major gaps / inconsistencies</SectionHeading>
          {summary.majorGaps.length === 0 ? (
            <p className="mt-1 text-xs italic text-muted-foreground">
              No gaps were recorded for this submission.
            </p>
          ) : (
            <ul className="mt-1 space-y-1">
              {summary.majorGaps.map((item) => (
                <li key={item} className="flex gap-1.5 text-xs text-foreground/85">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {claims.length} claim{claims.length === 1 ? "" : "s"} checked · {bundle.counts.supported}{" "}
        supported · {bundle.counts.partially_supported} partial · {bundle.counts.not_found} not
        found · {bundle.counts.could_not_verify} could not verify.
      </p>
    </div>
  );
}

export interface EvidencePanelProps {
  submission: SubmissionDetail;
  phase: EvidencePhase;
  run: EvaluationRun | null;
  error: string | null;
  starting: boolean;
  onStart: () => void;
}

export function EvidencePanel({
  submission,
  phase,
  run,
  error,
  starting,
  onStart,
}: EvidencePanelProps) {
  const bundle = run?.evidenceBundle ?? run?.result?.evidenceBundle ?? null;
  const isProject = submission.category === "project";

  return (
    <Card
      id="evidence-section"
      className="scroll-mt-24 overflow-hidden border-border/70 bg-card/60 backdrop-blur"
    >
      <CardHeader className="flex-row items-start justify-between gap-3 border-b border-border/60 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            Evidence &amp; AI vetting
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            What the team claims vs. what the repository, site and deck actually show.
          </p>
        </div>
        <Button
          size="sm"
          variant={phase === "ready" ? "outline" : "default"}
          onClick={onStart}
          disabled={starting || phase === "running"}
        >
          {starting || phase === "running" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {phase === "ready" || phase === "error" ? "Run again" : "Run evidence check"}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {/* Idle: explain what a run will read — empty state, not a dead card. */}
        {phase === "idle" && (
          <div className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center">
            <BrandMark size="sm" className="mx-auto" />
            <p className="mt-2 text-sm font-medium">No evidence check has been run yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              {isProject
                ? "This reads the public repository, fetches the deployed site, and compares them with the deck's claims and the submitted text."
                : "This reads the submitted material and extracts the claims a reviewer can check."}{" "}
              Nothing is scored by this panel.
            </p>
            <ul className="mx-auto mt-3 grid max-w-sm gap-1 text-left text-[11px] text-muted-foreground">
              <li className="flex items-center gap-1.5">
                <GitBranch className="h-3 w-3" aria-hidden />
                {isProject && "repoUrl" in submission && submission.repoUrl
                  ? "Repository: provided"
                  : "Repository: not provided"}
              </li>
              <li className="flex items-center gap-1.5">
                <Globe className="h-3 w-3" aria-hidden />
                {isProject && "demoUrl" in submission && submission.demoUrl
                  ? "Deployed site: provided"
                  : "Deployed site: not provided"}
              </li>
              <li className="flex items-center gap-1.5">
                <FileText className="h-3 w-3" aria-hidden />
                {isProject && submission.presentationClaims
                  ? "Deck claims: extracted"
                  : "Deck claims: none extracted"}
              </li>
            </ul>
          </div>
        )}

        {/* Loading states: starting a run, and the pipeline working. */}
        {(phase === "starting" || phase === "running") && (
          <div className="space-y-3" aria-live="polite">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {phase === "starting"
                ? "Starting the evidence check…"
                : "Reading the repository, the deployed site and the submitted deck…"}
            </div>
            <LineSkeletons rows={4} />
            <p className="text-[11px] text-muted-foreground">
              Safe to refresh: the run is stored and re-attached to this submission.
            </p>
          </div>
        )}

        {/* Error: actionable, never a silent blank. */}
        {phase === "error" && (
          <div
            role="alert"
            className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/[0.06] p-3"
          >
            <div className="flex items-start gap-2">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              <div>
                <p className="text-sm font-medium text-destructive">Evidence check unavailable</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {error ?? "The evidence run could not be completed."}
                </p>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Your judging scores are unaffected: evidence is advisory and is never written into
              your evaluation.
            </p>
            <Button size="sm" variant="outline" onClick={onStart} disabled={starting}>
              {starting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Try again
            </Button>
          </div>
        )}

        {/* Ready, but the run predates evidence bundles (old persisted data). */}
        {phase === "ready" && !bundle && (
          <div className="rounded-lg border border-dashed border-border/70 px-3 py-5 text-center">
            <p className="text-sm font-medium">This run has no evidence bundle</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              It was produced before evidence bundles existed. The score and reasoning are intact —
              run the check again to attach the sources and claim statuses.
            </p>
          </div>
        )}

        {phase === "ready" && bundle && run && (
          <>
            <FinalSummary bundle={bundle} run={run} />

            <div>
              <SectionHeading className="mb-1.5">Claims and their evidence status</SectionHeading>
              {bundle.claims.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/70 px-3 py-3 text-xs text-muted-foreground">
                  This submission contains no checkable claims yet — add a description or attach a
                  deck to make claims comparable with evidence.
                </p>
              ) : (
                <ul className="space-y-2">
                  {bundle.claims.map((check) => (
                    <ClaimRow key={check.id} check={check} />
                  ))}
                </ul>
              )}
            </div>

            <div>
              <SectionHeading className="mb-1.5">Evidence sources</SectionHeading>
              <ul className="space-y-2">
                {bundle.sources.map((source) => (
                  <SourceRow key={source.kind} source={source} />
                ))}
              </ul>
            </div>

            <p className="flex items-start gap-1.5 rounded-lg border border-border/60 bg-muted/20 p-2.5 text-[11px] leading-snug text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden />
              {bundle.disclaimer}
            </p>

            <p className="text-[11px] text-muted-foreground">
              {run.result?.model ? `Model ${run.result.model} · ` : ""}
              {run.result?.evaluatedAt
                ? `evaluated ${new Date(run.result.evaluatedAt).toLocaleString()}`
                : ""}{" "}
              · Advisory only: the marks you award below remain your decision.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Container: owns the run (and its refresh-safe resume) for one submission. */
export function EvidenceSection({ detail }: { detail: SubmissionDetail }) {
  const { phase, run, error, starting, start } = useEvidenceRun(detail);
  return (
    <EvidencePanel
      submission={detail}
      phase={phase}
      run={run}
      error={error}
      starting={starting}
      onStart={start}
    />
  );
}
