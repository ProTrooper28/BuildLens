import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { VerdictToneBadge } from "@/components/evaluation/inspection-ui";
import {
  ClaimTable,
  EmptyState,
  EvidenceProgress,
  Eyebrow,
  FeatureTable,
  ListBlock,
  Surface,
  SurfaceBody,
} from "@/components/evaluation/analysis-ui";
import type { EvidencePhase } from "@/hooks/useEvidenceRun";
import { cn } from "@/lib/utils";
import type { InspectionReport } from "@/services/inspection/types";
import { SEVERITY_LABELS } from "@/services/verification/types";

/**
 * Judge summary — the first screen of an evaluation.
 *
 * The judge's real question is “does what the team claimed match what they
 * built?”, so the page answers it in that order and nothing else:
 *
 *   1. the deterministic overall score, and why it was capped
 *   2. a four-line executive verdict
 *   3. how many claims and features were verified, partial or absent
 *   4. a document/implementation mismatch, when there is one
 *   5. the concerns and strengths that follow from those numbers
 *   6. the score breakdown, then the claim and feature tables
 *   7. one link to the detailed analysis for everything else
 *
 * Every number here is computed by `services/verification` from the evidence;
 * the AI narrative is shown as an interpretation and never as the verdict.
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

function scoreTone(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 65) return "text-foreground";
  if (score >= 45) return "text-warning";
  return "text-destructive";
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
  const claims = report?.sections.find((section) => section.id === "claims")?.checks ?? [];

  return (
    <Surface id="judge-summary">
      {/* Existing "Why?" links in the scoring panel point at this anchor. */}
      <span id="evidence-section" aria-hidden />

      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-5 py-4">
        <div className="min-w-0">
          <Eyebrow>Project assessment</Eyebrow>
          <h2 className="mt-1 text-[15px] font-semibold tracking-tight">What BuildLens found</h2>
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
            {verdict
              ? `${verdict.projectTypeLabel} · claims checked against the deck, the repository and the deployed app.`
              : "BuildLens reads the deck, repository and deployed app, then checks every claim against what it read."}
          </p>
        </div>
        {verdict && (
          <VerdictToneBadge
            tone={verdict.tone}
            label={verdict.toneLabel}
            className="mt-1 shrink-0"
          />
        )}
      </header>

      <SurfaceBody className="space-y-6">
        {running && !verdict && <EvidenceProgress bundle={null} />}

        {!running && !verdict && (
          <div role={phase === "error" ? "alert" : undefined}>
            <EmptyState
              tone={phase === "error" ? "danger" : "neutral"}
              title={
                phase === "error" ? "Could not verify this submission" : "Inspection not started"
              }
              description={
                phase === "error"
                  ? (error ??
                    "The inspection could not be completed, so nothing was verified. That is a gap in the evidence, not a negative finding.")
                  : "Start the inspection to read the deck, repository and deployed app and check the team's claims against them."
              }
              action={
                <>
                  <Button size="sm" variant="outline" onClick={onStart} disabled={starting}>
                    {starting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    {phase === "error" ? "Try again" : "Start inspection"}
                  </Button>
                  {/* The technical page stays reachable even when nothing was read:
                      it explains each source that failed. */}
                  <Button size="sm" variant="ghost" asChild>
                    <Link to="/evaluation/project/$id/analysis" params={{ id: submissionId }}>
                      View Detailed Analysis
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </Button>
                </>
              }
            />
          </div>
        )}

        {report && verdict && (
          <>
            {/* -------------------------------------------------- overall score */}
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <Eyebrow>Overall score</Eyebrow>
                <div className="mt-1 flex items-baseline gap-2">
                  <span
                    className={cn(
                      "tabular-nums text-4xl font-semibold tracking-tight",
                      scoreTone(verdict.overallScore),
                    )}
                  >
                    {verdict.overallScore ?? "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {verdict.overallScore === null
                      ? "not scored"
                      : `/ 100 · ${verdict.overallBand}`}
                  </span>
                </div>
              </div>
              <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
                {verdict.overallScore === null
                  ? "Nothing measurable could be read, so no score was invented."
                  : "Computed from the evidence below by fixed rules — not chosen by the AI."}
              </p>
            </div>

            {verdict.breakdown.caps.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5">
                <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-destructive">
                  Score capped
                </p>
                <ul className="mt-1 space-y-0.5">
                  {verdict.breakdown.caps.map((cap) => (
                    <li key={cap.reason} className="text-[11px] leading-relaxed text-foreground/80">
                      {cap.reason} Maximum {cap.cap}/100.
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* --------------------------------------------- executive verdict */}
            <div>
              <Eyebrow>Executive verdict</Eyebrow>
              <p className="mt-1.5 text-[15px] font-semibold leading-relaxed text-foreground">
                {verdict.headline}
              </p>
              {verdict.executiveSummary && (
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {verdict.executiveSummary}
                </p>
              )}
            </div>

            {/* ------------------------------------------------ key finding strip */}
            <ul className="flex flex-wrap gap-x-5 gap-y-2 border-y border-border/70 py-3 text-[11px]">
              <FindingCount
                count={verdict.featureSummary.supported}
                label="features verified"
                dot="bg-success"
                text="text-success"
              />
              <FindingCount
                count={verdict.featureSummary.partial}
                label="partially supported"
                dot="bg-warning"
                text="text-warning"
              />
              <FindingCount
                count={verdict.featureSummary.missing}
                label="features not found"
                dot="bg-destructive"
                text="text-destructive"
              />
              <FindingCount
                count={verdict.counts.not_found}
                label="claims not supported"
                dot="bg-destructive"
                text="text-destructive"
              />
              <FindingCount
                count={verdict.severityCounts.critical}
                label="critical findings"
                dot="bg-destructive"
                text="text-destructive"
              />
              <FindingCount
                count={verdict.severityCounts.low}
                label="low-priority notes"
                dot="bg-muted-foreground/45"
                text="text-muted-foreground"
              />
            </ul>

            {/* ------------------------------------------- document mismatch */}
            {verdict.mismatch.level !== "none" && (
              <div
                className={cn(
                  "rounded-lg border px-4 py-3",
                  verdict.mismatch.level === "major"
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-warning/40 bg-warning/5",
                )}
                role={verdict.mismatch.level === "major" ? "alert" : undefined}
              >
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  {verdict.mismatch.level === "major"
                    ? "Major document / implementation mismatch"
                    : "Possible document mismatch"}
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/90">
                  {verdict.mismatch.headline}
                </p>
                <ul className="mt-2 space-y-1">
                  {verdict.mismatch.signals.slice(0, 3).map((signal) => (
                    <li
                      key={signal.id}
                      className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground"
                    >
                      <span
                        className={cn(
                          "mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full",
                          signal.severity === "critical" || signal.severity === "high"
                            ? "bg-destructive"
                            : "bg-warning",
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0">{signal.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ------------------------------------------- candidate-provided */}
            {verdict.candidateProvided.length > 0 && (
              <div className="rounded-lg border border-border/70 bg-muted/20 px-4 py-3">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Candidate-provided
                </h3>
                <ul className="mt-1.5 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  {verdict.candidateProvided.map((fact) => (
                    <li
                      key={`${fact.label}-${fact.value}`}
                      className="flex flex-wrap items-baseline gap-x-1.5 text-[12px] leading-relaxed"
                    >
                      <span className="text-muted-foreground">{fact.label}:</span>
                      <span className="font-medium text-foreground/90">{fact.value}</span>
                      <span className="text-[10px] text-muted-foreground/70">
                        ({fact.source})
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                  Stated by the candidate. BuildLens did not verify these details and does not
                  count them as claims.
                </p>
              </div>
            )}

            {/* ------------------------------------------- concerns & strengths */}
            <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
              <div className="min-w-0">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Key concerns
                </h3>
                {verdict.keyConcerns.length === 0 ? (
                  <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                    No unsupported claim or missing feature was found in the evidence that was read.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {verdict.keyConcerns.map((concern) => (
                      <li key={concern.text} className="flex gap-2.5 text-[13px] leading-relaxed">
                        <span
                          className={cn(
                            "mt-0.5 w-14 shrink-0 text-[9px] font-semibold uppercase tracking-[0.1em]",
                            concern.severity === "critical" || concern.severity === "high"
                              ? "text-destructive"
                              : concern.severity === "medium"
                                ? "text-warning"
                                : "text-muted-foreground",
                          )}
                        >
                          {SEVERITY_LABELS[concern.severity]}
                        </span>
                        <span className="min-w-0 text-foreground/90">{concern.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <ListBlock
                title="Key strengths"
                items={verdict.strengths}
                empty="Nothing was verified strongly enough to list as a strength."
                tone="success"
                limit={4}
              />
            </div>

            {/* --------------------------------------------- score breakdown */}
            <div className="border-t border-border/70 pt-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Score breakdown
                </h3>
                <p className="text-[10px] text-muted-foreground">
                  Fixed weights · a dimension that could not be measured is left out, not guessed
                </p>
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {verdict.breakdown.dimensions.map((dimension) => (
                  <div
                    key={dimension.id}
                    className="rounded-lg border border-border/70 px-3 py-2"
                    title={dimension.reason}
                  >
                    <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                      {dimension.label}
                    </p>
                    <p className="mt-0.5 flex items-baseline gap-1">
                      <span
                        className={cn(
                          "tabular-nums text-[17px] font-semibold",
                          scoreTone(dimension.score),
                        )}
                      >
                        {dimension.score ?? "—"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {dimension.score === null
                          ? "could not measure"
                          : `/100 · ${dimension.weight}%`}
                      </span>
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* -------------------------------------------------- claim table */}
            <div className="border-t border-border/70 pt-1">
              <div className="flex items-baseline justify-between gap-3 py-3">
                <div>
                  <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Claim verification
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {verdict.counts.supported} supported · {verdict.counts.partially_supported}{" "}
                    partial · {verdict.counts.not_found} not supported ·{" "}
                    {verdict.counts.could_not_verify} could not verify
                  </p>
                </div>
                <Link
                  to="/evaluation/project/$id/analysis"
                  params={{ id: submissionId }}
                  hash="analysis-claims"
                  className="shrink-0 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  All {claims.length} claims
                </Link>
              </div>
              <div className="-mx-5">
                <ClaimTable
                  checks={claims}
                  limit={5}
                  empty="No checkable claims were extracted from this submission."
                />
              </div>
            </div>

            {/* ------------------------------------------------ feature table */}
            <div className="border-t border-border/70 pt-1">
              <div className="flex items-baseline justify-between gap-3 py-3">
                <div>
                  <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Feature verification
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {verdict.featureSummary.tested} of {verdict.featureSummary.total} features were
                    observable in the deployed app · the rest were checked in the repository only
                  </p>
                </div>
                <Link
                  to="/evaluation/project/$id/analysis"
                  params={{ id: submissionId }}
                  hash="analysis-features"
                  className="shrink-0 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  All {verdict.featureSummary.total} features
                </Link>
              </div>
              <div className="-mx-5">
                <FeatureTable
                  features={verdict.features}
                  limit={5}
                  empty="No feature-level claims were extracted, so no feature could be tested."
                />
              </div>
            </div>

            {/* The evidence is persisted before the model runs, so the findings
                are readable immediately. Only the narrative is still pending. */}
            {running && (
              <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Evidence collected — generating the AI summary. Everything above is already final.
              </p>
            )}

            <div className="border-t border-border/70 pt-5">
              <Eyebrow>AI assessment</Eyebrow>
              <p className="mt-2 text-[13px] leading-relaxed text-foreground/90">
                {verdict.aiSummary ??
                  "No AI narrative was produced for this run. Nothing was invented to replace it — every finding on this page comes from the deterministic source readers."}
              </p>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                An interpretation of the evidence above. It does not decide the score; the criteria
                below are yours to award.
              </p>
            </div>

            {verdict.missingInputs.length > 0 && (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {verdict.missingInputs.join(" ")}
              </p>
            )}

            {partial && error && (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Why the AI summary is missing:{" "}
                {error.length > 200 ? `${error.slice(0, 200)}…` : error}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-4">
              <Button asChild size="sm">
                <Link to="/evaluation/project/$id/analysis" params={{ id: submissionId }}>
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
              <span className="ml-auto text-[11px] text-muted-foreground">
                {verdict.aiAvailable
                  ? "Includes AI narrative"
                  : partial
                    ? "Evidence only — AI narrative unavailable"
                    : "Evidence only"}
              </span>
            </div>

            <p className="text-[11px] leading-relaxed text-muted-foreground/80">
              {report.disclaimer}
            </p>
          </>
        )}
      </SurfaceBody>
    </Surface>
  );
}

function FindingCount({
  count,
  label,
  dot,
  text,
}: {
  count: number;
  label: string;
  dot: string;
  text: string;
}) {
  return (
    <li className={cn("inline-flex items-center gap-1.5", count === 0 && "text-muted-foreground")}>
      <span
        className={cn("h-1.5 w-1.5 rounded-full", count === 0 ? "bg-muted-foreground/30" : dot)}
        aria-hidden
      />
      <span
        className={cn("tabular-nums font-semibold", count === 0 ? "text-muted-foreground" : text)}
      >
        {count}
      </span>
      <span className={count === 0 ? "text-muted-foreground" : "text-foreground/80"}>{label}</span>
    </li>
  );
}
