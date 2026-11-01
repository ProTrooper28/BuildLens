import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CheckStatusBadge, EvidenceBasisChip, VerdictToneBadge, DeploymentRowRow } from "@/components/evaluation/inspection-ui";
import { ClaimVerification } from "@/components/evaluation/ClaimVerification";
import { JudgeAttention } from "@/components/evaluation/JudgeAttention";
import { useEvidenceRun } from "@/hooks/useEvidenceRun";
import { useSubmissionDetail } from "@/hooks/useJudging";
import { buildInspectionReport } from "@/services/inspection";
import type { InspectionCheck, InspectionSection } from "@/services/inspection/types";
import type { ProjectDetail } from "@/types/evaluation";

/**
 * Detailed analysis.
 *
 * The technical evidence behind the judge summary — every section, every check,
 * the exact file path / URL / page number behind it, and how confident BuildLens
 * is. Deliberately a separate page so the default submission view stays simple.
 */

export function DetailedAnalysis({ submissionId }: { submissionId: string }) {
  const detailQuery = useSubmissionDetail(submissionId);

  if (detailQuery.isLoading) {
    return (
      <AppLayout
        title="Detailed analysis"
        crumbs={[
          { label: "Evaluation", to: "/evaluation" },
          { label: "Projects", to: "/evaluation/project" },
        ]}
      >
        <div className="h-64 animate-pulse rounded-xl border border-border/70 bg-card/40" />
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
          { label: "Projects", to: "/evaluation/project" },
        ]}
      >
        <div className="rounded-xl border border-border/70 bg-card/40 px-6 py-16 text-center">
          <XCircle className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="mt-3 text-sm font-medium">This submission is no longer available.</p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to="/evaluation/project">Back to projects</Link>
          </Button>
        </div>
      </AppLayout>
    );
  }

  if (detail.category === "resume") {
    return (
      <AppLayout title={detail.name}>
        <div className="rounded-xl border border-border/70 bg-card/40 px-6 py-12 text-center">
          <p className="text-sm font-medium">Detailed analysis is available for projects</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Resumes are evaluated from the submitted document; there is no repository or deployment
            to inspect.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to="/evaluation/resume/$id" params={{ id: detail.id }}>
              Back to the evaluation
            </Link>
          </Button>
        </div>
      </AppLayout>
    );
  }

  return <DetailedAnalysisView detail={detail} />;
}

function DetailedAnalysisView({ detail }: { detail: ProjectDetail }) {
  const evidence = useEvidenceRun(detail, { autoStart: true });
  const report = useMemo(
    () =>
      evidence.bundle
        ? buildInspectionReport({
            detail,
            bundle: evidence.bundle,
            evaluation: evidence.run?.result ?? null,
            runError: evidence.error,
          })
        : null,
    [detail, evidence.bundle, evidence.run, evidence.error],
  );

  const running = evidence.phase === "starting" || evidence.phase === "running";

  return (
    <AppLayout
      title={`Detailed analysis — ${detail.name}`}
      subtitle="Every check, its result, and the evidence behind it"
      crumbs={[
        { label: "Evaluation", to: "/evaluation" },
        { label: "Projects", to: "/evaluation/project" },
        { label: detail.name },
        { label: "Detailed analysis" },
      ]}
      actions={
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" asChild>
            <Link to="/evaluation/project/$id" params={{ id: detail.id }}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Judge summary
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={evidence.start}
            disabled={evidence.starting || running}
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Re-run
          </Button>
        </div>
      }
    >
      {running && !report && (
        <div className="space-y-3 rounded-xl border border-border/70 bg-card/40 p-6" aria-live="polite">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
            Inspecting the deck, repository and deployed application…
          </div>
          <p className="text-xs text-muted-foreground">
            The page fills in as each source is read. It is safe to leave and come back.
          </p>
        </div>
      )}

      {!running && !report && (
        <div
          role={evidence.phase === "error" ? "alert" : undefined}
          className={
            evidence.phase === "error"
              ? "rounded-xl border border-destructive/30 bg-destructive/[0.06] px-6 py-12 text-center"
              : "rounded-xl border border-dashed border-border/70 px-6 py-12 text-center"
          }
        >
          <AlertTriangle
            className={
              evidence.phase === "error"
                ? "mx-auto h-6 w-6 text-destructive"
                : "mx-auto h-6 w-6 text-muted-foreground"
            }
            aria-hidden
          />
          <p className="mt-3 text-sm font-medium">Could not verify this submission</p>
          <p className="mx-auto mt-1 max-w-lg text-xs text-muted-foreground">
            {evidence.error ??
              "No inspection has run for this submission yet, so there is no evidence to show. Nothing was invented to fill the page."}
          </p>
          <Button size="sm" variant="outline" className="mt-4" onClick={evidence.start}>
            {evidence.starting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Run the inspection
          </Button>
        </div>
      )}

      {report && (
        <div className="space-y-5 pb-10">
          <Card className="border-border/70 bg-card/60">
            <CardContent className="space-y-3 pt-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-primary/25 bg-primary/[0.07] text-primary">
                  {report.projectTypeLabel}
                </Badge>
                <VerdictToneBadge tone={report.verdict.tone} label={report.verdict.toneLabel} />
                {report.verdict.score !== null && (
                  <Badge variant="outline" className="border-border text-muted-foreground">
                    Automated score {report.verdict.score}/100
                  </Badge>
                )}
                <span className="text-[11px] text-muted-foreground">
                  Generated {new Date(report.generatedAt).toLocaleString()}
                </span>
              </div>
              <p className="text-sm font-medium leading-snug">{report.verdict.headline}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">{report.strategy}</p>
              <nav aria-label="Analysis sections" className="flex flex-wrap gap-1.5">
                {report.sections.map((section) => (
                  <a
                    key={section.id}
                    href={`#section-${section.id}`}
                    className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    <span className="font-mono font-semibold text-foreground/70">
                      {section.letter}
                    </span>
                    {section.label}
                    <ChevronRight className="h-3 w-3" aria-hidden />
                  </a>
                ))}
              </nav>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/50">
            <CardContent className="space-y-5 pt-5">
              {report.verdict.candidateProvided.length > 0 && (
                <div>
                  <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Candidate-provided
                  </h2>
                  <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
                    {report.verdict.candidateProvided.map((fact) => (
                      <li
                        key={`${fact.label}-${fact.value}`}
                        className="flex flex-wrap items-baseline gap-x-1.5 text-xs"
                      >
                        <span className="text-muted-foreground">{fact.label}:</span>
                        <span className="font-medium text-foreground/90">{fact.value}</span>
                        <span className="text-[10px] text-muted-foreground/70">
                          ({fact.source})
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Stated by the candidate. Not verified and not counted as claims.
                  </p>
                </div>
              )}

              <JudgeAttention findings={report.verdict.attention} />

              <ClaimVerification
                claims={report.verdict.claimsTable}
                counts={report.verdict.verdictCounts}
                id="detailed-claims"
              />
            </CardContent>
          </Card>

          {report.verdict.deployment.applicable && (
            <section id="section-deployment-detail" className="scroll-mt-24">
              <Card className="overflow-hidden border-border/70 bg-card/50">
                <CardHeader className="border-b border-border/60 pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/40 font-mono text-[11px] font-semibold">
                        D
                      </span>
                      <div className="min-w-0">
                        <h2 className="text-sm font-semibold">Deployed application</h2>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          What BuildLens could observe from the public page: reachability, HTTPS, response, performance signals, security signals, functionality signals and responsive-layout signals. Not a penetration test.
                        </p>
                      </div>
                    </div>
                    <CheckStatusBadge status={report.verdict.deployment.rows[0]?.status ?? "could_not_verify"} />
                  </div>
                  <p className="mt-2 text-xs text-foreground/80">
                    Inspected from {report.verdict.deployment.url ?? "the submitted URL"} at {new Date(report.verdict.deployment.checkedAt).toLocaleString()}.
                  </p>
                </CardHeader>
                <CardContent className="space-y-2.5 pt-3">
                  {report.verdict.deployment.rows.map((row) => {
                    const basis: "observed" | "inferred" | "not_detected" | "could_not_verify" =
                      row.status === "good" || row.status === "warning" || row.status === "critical"
                        ? "observed"
                        : row.status === "not_detected"
                          ? "not_detected"
                          : "could_not_verify";
                    return <DeploymentRowRow key={row.id} row={row} basis={basis} />;
                  })}
                  {report.verdict.deployment.limitations.length > 0 && (
                    <ul className="space-y-1 border-l-2 border-primary/20 pl-2.5">
                      {report.verdict.deployment.limitations.map((limitation, index) => (
                        <li key={index} className="text-xs leading-relaxed text-muted-foreground">
                          {limitation}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </section>
          )}

          {report.sections.map((section) => (
            <SectionCard key={section.id} section={section} />
          ))}

          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground/80">How to read this page</p>
            <p className="mt-1">{report.disclaimer}</p>
            <p className="mt-1">
              {report.ai.available
                ? `AI analysis: ${report.ai.model ?? "model not reported"}. AI text is an interpretation of the evidence above, not a new source.`
                : "No AI analysis was produced for this run; every finding above comes from the deterministic source readers."}
            </p>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

function SectionCard({ section }: { section: InspectionSection }) {
  return (
    <section id={`section-${section.id}`} className="scroll-mt-24">
      <Card className="overflow-hidden border-border/70 bg-card/50">
        <CardHeader className="border-b border-border/60 pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2.5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/40 font-mono text-[11px] font-semibold">
                {section.letter}
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">{section.label}</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{section.description}</p>
              </div>
            </div>
            <CheckStatusBadge status={section.status} />
          </div>
          <p className="mt-2 text-xs text-foreground/80">{section.summary}</p>
        </CardHeader>
        <CardContent className="space-y-3 pt-3">
          {section.checks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-xs text-muted-foreground">
              {section.empty ?? "Could not verify this source."}
            </p>
          ) : (
            <ul className="space-y-2.5">
              {section.checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function CheckRow({ check }: { check: InspectionCheck }) {
  const basis: "observed" | "inferred" | "not_detected" | "could_not_verify" =
    check.status === "good" || check.status === "supported" || check.status === "warning" || check.status === "critical"
      ? "observed"
      : check.status === "not_detected"
        ? "not_detected"
        : "could_not_verify";

  return (
    <li className="rounded-lg border border-border/60 bg-background/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="min-w-0 text-sm font-medium leading-snug">{check.title}</p>
            <EvidenceBasisChip basis={basis} />
          </div>
        </div>
        <CheckStatusBadge status={check.status} />
      </div>
      <p className="mt-1 text-xs font-medium text-foreground/85">{check.result}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{check.explanation}</p>

      {check.evidence.length > 0 && (
        <ul className="mt-2 space-y-1 border-l-2 border-primary/20 pl-2.5">
          {check.evidence.slice(0, 10).map((item, index) => (
            <li
              key={`${check.id}-evidence-${index}`}
              className="break-words font-mono text-[11px] leading-snug text-foreground/75"
            >
              {item}
            </li>
          ))}
          {check.evidence.length > 10 && (
            <li className="text-[11px] text-muted-foreground">
              +{check.evidence.length - 10} more evidence item
              {check.evidence.length - 10 === 1 ? "" : "s"}
            </li>
          )}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" aria-hidden />
          Confidence: {check.confidence}
        </span>
        {check.pageRefs && check.pageRefs.length > 0 && (
          <span>Deck page {check.pageRefs.join(", ")}</span>
        )}
        {check.claimKind && <span>{check.claimKind.replace(/_/g, " ")}</span>}
      </div>
    </li>
  );
}
