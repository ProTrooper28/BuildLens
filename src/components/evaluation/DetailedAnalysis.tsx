import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, Loader2, RefreshCw } from "lucide-react";

import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { CheckStatusBadge, VerdictToneBadge } from "@/components/evaluation/inspection-ui";
import { DeploymentDetail } from "@/components/evaluation/deployment-checks";
import {
  CheckList,
  ClaimRow,
  CountLine,
  EmptyState,
  EvidenceProgress,
  FeatureTable,
  ListBlock,
  MetricGrid,
  SectionNav,
  Surface,
  SurfaceBody,
  SurfaceHeader,
} from "@/components/evaluation/analysis-ui";
import { useEvidenceRun } from "@/hooks/useEvidenceRun";
import { useSubmissionDetail } from "@/hooks/useJudging";
import { buildInspectionReport } from "@/services/inspection";
import type {
  InspectionReport,
  InspectionSection,
  InspectionSectionId,
} from "@/services/inspection/types";
import type { ProjectDetail } from "@/types/evaluation";

/**
 * Detailed analysis.
 *
 * The evidence behind the judge summary, in the order a judge reads it: the
 * project, its claims, the documents, the code, the live app, then security,
 * performance, functionality and the model's own read. Every row opens onto its
 * exact finding, source and confidence — nothing is dumped on the page at once.
 *
 * A separate route on purpose: the default submission screen stays short.
 */

const SECTIONS = [
  { id: "analysis-overview", label: "Overview" },
  { id: "analysis-claims", label: "Claims" },
  { id: "analysis-features", label: "Features" },
  { id: "analysis-document", label: "Document" },
  { id: "analysis-repository", label: "Repository" },
  { id: "analysis-deployment", label: "Deployment" },
  { id: "analysis-security", label: "Security" },
  { id: "analysis-performance", label: "Performance" },
  { id: "analysis-functionality", label: "Functionality" },
  { id: "analysis-ai", label: "AI insights" },
  { id: "analysis-detail", label: "Evidence" },
] as const;

const CRUMBS = [
  { label: "Evaluation", to: "/evaluation" },
  { label: "Projects", to: "/evaluation/project" },
] as const;

export function DetailedAnalysis({ submissionId }: { submissionId: string }) {
  const detailQuery = useSubmissionDetail(submissionId);

  if (detailQuery.isLoading) {
    return (
      <AppLayout title="Detailed analysis" crumbs={[...CRUMBS]}>
        <div className="space-y-3">
          <div className="h-11 animate-pulse rounded-lg border border-border bg-card/60" />
          <div className="h-40 animate-pulse rounded-xl border border-border bg-card/60" />
          <div className="h-64 animate-pulse rounded-xl border border-border bg-card/60" />
        </div>
      </AppLayout>
    );
  }

  const detail = detailQuery.data ?? null;
  if (!detail) {
    return (
      <AppLayout title="Submission not found" crumbs={[...CRUMBS]}>
        <EmptyState
          title="This submission is no longer available."
          description="It may have been removed from the cohort, or the link is malformed."
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/evaluation/project">Back to projects</Link>
            </Button>
          }
        />
      </AppLayout>
    );
  }

  if (detail.category === "resume") {
    return (
      <AppLayout title={detail.name} crumbs={[...CRUMBS]}>
        <EmptyState
          title="Detailed analysis is available for projects"
          description="Resumes are evaluated from the submitted document; there is no repository or deployment to inspect."
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/evaluation/resume/$id" params={{ id: detail.id }}>
                Back to the evaluation
              </Link>
            </Button>
          }
        />
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
      title={detail.name}
      subtitle="Detailed analysis"
      crumbs={[...CRUMBS, { label: detail.name }, { label: "Detailed analysis" }]}
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
      {!report && (
        <div className="space-y-4">
          {running ? (
            <Surface>
              <SurfaceBody>
                <EvidenceProgress bundle={null} />
              </SurfaceBody>
            </Surface>
          ) : (
            <EmptyState
              tone={evidence.phase === "error" ? "danger" : "neutral"}
              title="Could not verify this submission"
              description={
                evidence.error ??
                "No inspection has run for this submission yet, so there is no evidence to show. Nothing was invented to fill the page."
              }
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={evidence.start}
                  disabled={evidence.starting}
                >
                  {evidence.starting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Run the inspection
                </Button>
              }
            />
          )}
        </div>
      )}

      {report && <Report report={report} detail={detail} running={running} />}
    </AppLayout>
  );
}

function Report({
  report,
  detail,
  running,
}: {
  report: InspectionReport;
  detail: ProjectDetail;
  running: boolean;
}) {
  const section = (id: InspectionSectionId) =>
    report.sections.find((entry) => entry.id === id) ?? null;

  const claims = section("claims");
  const document = section("document");
  const repository = section("repository");
  const ai = section("ai");
  const rubric = section("rubric");
  const evidenceInventory = section("evidence");

  const claimChecks = claims?.checks ?? [];
  const documentChecks = document?.checks ?? [];
  const repositoryChecks = repository?.checks ?? [];
  const readableSources = report.sources.filter((source) => source.readable).length;

  return (
    <div className="pb-10">
      <SectionNav items={SECTIONS.map((entry) => ({ id: entry.id, label: entry.label }))} />

      <div className="space-y-5">
        {/* ------------------------------------------------------- overview */}
        <Surface id="analysis-overview">
          <SurfaceHeader
            eyebrow="Project overview"
            title={detail.name}
            description={report.strategy}
            aside={
              <>
                <span className="tabular-nums text-xs text-muted-foreground">
                  {report.verdict.overallScore === null
                    ? "Not scored"
                    : `${report.verdict.overallScore}/100`}
                </span>
                <VerdictToneBadge tone={report.verdict.tone} label={report.verdict.toneLabel} />
              </>
            }
          />
          <SurfaceBody className="space-y-5">
            <div>
              <p className="text-[15px] font-semibold leading-relaxed">{report.verdict.headline}</p>
              {report.verdict.executiveSummary && (
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {report.verdict.executiveSummary}
                </p>
              )}
              <p className="mt-1.5 text-xs text-muted-foreground">
                {report.projectTypeLabel}
                {detail.team ? ` · ${detail.team}` : ""}
                {` · generated ${new Date(report.generatedAt).toLocaleString()}`}
              </p>
            </div>

            {report.mismatch.level !== "none" && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3.5 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-destructive">
                  {report.mismatch.level === "major"
                    ? "Major document / implementation mismatch"
                    : "Possible document mismatch"}
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-foreground/90">
                  {report.mismatch.headline}
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 border-t border-border/70 pt-4 sm:grid-cols-4">
              {report.score.dimensions.map((dimension) => (
                <div key={dimension.id} title={dimension.reason}>
                  <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    {dimension.label}
                  </p>
                  <p className="mt-0.5 text-[13px] font-semibold tabular-nums">
                    {dimension.score === null ? "Could not measure" : `${dimension.score}/100`}
                  </p>
                </div>
              ))}
            </div>

            <MetricGrid
              items={[
                { label: "Claims checked", value: String(report.counts.total) },
                { label: "Supported", value: String(report.counts.supported) },
                {
                  label: "Needs review",
                  value: String(report.counts.not_found + report.counts.partially_supported),
                  hint: "not found or partially supported",
                },
                {
                  label: "Sources read",
                  value: `${readableSources} of ${report.sources.length}`,
                },
              ]}
            />

            <CountLine counts={report.counts} />

            {(detail.repoUrl || detail.demoUrl) && (
              <div className="flex flex-wrap items-center gap-3 border-t border-border/70 pt-4">
                {detail.repoUrl && (
                  <a
                    href={detail.repoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Repository
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                )}
                {detail.demoUrl && (
                  <a
                    href={detail.demoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Deployed app
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                )}
                {running && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    Refreshing this report
                  </span>
                )}
              </div>
            )}
          </SurfaceBody>
        </Surface>

        {/* --------------------------------------------------------- claims */}
        <Surface id="analysis-claims">
          <SurfaceHeader
            eyebrow="Claim verification"
            title="Every claim, and what supports it"
            description={
              claims?.summary ??
              "What the team says they built, checked against the sources that were actually read."
            }
            aside={claims && <CheckStatusBadge status={claims.status} />}
          />
          {claimChecks.length === 0 ? (
            <p className="px-5 py-6 text-[13px] text-muted-foreground">
              {claims?.empty ?? "No checkable claims were extracted from this submission."}
            </p>
          ) : (
            <div>
              {claimChecks.map((check) => (
                <ClaimRow key={check.id} check={check} />
              ))}
            </div>
          )}
        </Surface>

        {/* ------------------------------------------------------- features */}
        <Surface id="analysis-features">
          <SurfaceHeader
            eyebrow="Feature verification"
            title="Claimed features, and how each one was checked"
            description="A feature only counts as supported when a source outside the deck carries it; tested means the deployed application was read and showed it."
          />
          <div className="border-t border-border/70">
            <FeatureTable
              features={report.features}
              empty="No feature-level claims were extracted from this submission, so no feature could be tested."
            />
          </div>
        </Surface>

        {/* ------------------------------------------------------- document */}
        <Surface id="analysis-document">
          <SurfaceHeader
            eyebrow="Document analysis"
            title="Submitted deck"
            description={document?.summary ?? "No presentation was attached to this submission."}
            aside={document && <CheckStatusBadge status={document.status} />}
          />
          <SurfaceBody>
            <MetricGrid
              items={[
                { label: "Pages with text", value: findResult(documentChecks, "document.pages") },
                {
                  label: "Claims identified",
                  value: findResult(documentChecks, "document.claims"),
                },
                {
                  label: "Page references",
                  value: findResult(documentChecks, "document.page_refs"),
                },
                { label: "OCR", value: findResult(documentChecks, "document.ocr") ?? "Not needed" },
              ]}
            />
          </SurfaceBody>
          <div className="border-t border-border/70">
            <CheckList
              checks={documentChecks}
              empty={document?.empty ?? "No document was read for this submission."}
            />
          </div>
        </Surface>

        {/* ----------------------------------------------------- repository */}
        <Surface id="analysis-repository">
          <SurfaceHeader
            eyebrow="Repository"
            title="What the code shows"
            description={repository?.summary ?? "No repository was read for this submission."}
            aside={repository && <CheckStatusBadge status={repository.status} />}
          />
          <SurfaceBody>
            <MetricGrid
              items={[
                {
                  label: "Stack",
                  value:
                    detail.technologies.length > 0 ? detail.technologies.join(" · ") : "Not listed",
                },
                { label: "Findings", value: String(repositoryChecks.length) },
                { label: "Tests", value: findResult(repositoryChecks, "repo.code.tests") },
                {
                  label: "Evidence items",
                  value: String(
                    repositoryChecks.reduce((total, check) => total + check.evidence.length, 0),
                  ),
                },
              ]}
            />
          </SurfaceBody>
          <div className="border-t border-border/70">
            <CheckList
              checks={repositoryChecks}
              empty={
                repository?.empty ??
                "Submit a public repository URL to inspect implementation evidence."
              }
            />
          </div>
        </Surface>

        {/* ----------------------------------------------------- deployment */}
        <DeploymentSection report={report} />

        {/* ------------------------------------- security / performance / ux */}
        <DomainSection id="analysis-security" section={section("security")} label="Security" />
        <DomainSection
          id="analysis-performance"
          section={section("performance")}
          label="Performance"
        />
        <DomainSection
          id="analysis-functionality"
          section={section("functionality")}
          label="Functionality"
        />

        {/* ------------------------------------------------------------- ai */}
        <Surface id="analysis-ai">
          <SurfaceHeader
            eyebrow="AI insights"
            title="BuildLens assessment"
            description="An interpretation of the evidence on this page. It is not a source and not a score."
            aside={
              <span className="text-[11px] text-muted-foreground">
                {report.ai.available ? (report.ai.model ?? "Model run") : "No model run"}
              </span>
            }
          />
          <SurfaceBody className="space-y-5">
            <p className="text-[13px] leading-relaxed text-foreground/90">
              {report.verdict.aiSummary ??
                report.ai.unavailableReason ??
                "No AI narrative was produced for this run. Nothing was invented to replace it — every finding on this page comes from the deterministic source readers."}
            </p>
            <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
              <ListBlock
                title="Strengths"
                items={report.verdict.strengths}
                empty="No strength was recorded."
                tone="success"
                limit={4}
              />
              <ListBlock
                title="Concerns"
                items={report.verdict.problems}
                empty="No concern was raised."
                tone="warning"
                limit={4}
              />
            </div>
            <div>
              <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Judge attention
              </h3>
              <ul className="mt-2 space-y-1.5">
                {report.verdict.judgeBullets.map((bullet, index) => (
                  <li
                    key={`${bullet}-${index}`}
                    className="flex gap-2 text-[13px] leading-relaxed text-foreground/90"
                  >
                    <span
                      className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70"
                      aria-hidden
                    />
                    <span className="min-w-0">{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
          </SurfaceBody>
          {ai && ai.checks.length > 0 && (
            <div className="border-t border-border/70">
              <CheckList checks={ai.checks} empty="" />
            </div>
          )}
        </Surface>

        {/* -------------------------------------------------------- evidence */}
        <Surface id="analysis-detail">
          <SurfaceHeader
            eyebrow="Evidence"
            title="Sources, rubric signals and the full trail"
            description="Every source BuildLens tried to read, what it got from it, and the automated readings that stay advisory."
          />
          <div className="border-b border-border/70 px-5 py-4">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Sources
            </h3>
            <ul className="mt-2 space-y-1.5">
              {report.sources.map((source) => (
                <li
                  key={`${source.kind}-${source.label}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
                >
                  <div className="min-w-0">
                    <span className="text-[13px] font-medium">{source.label}</span>
                    {!source.readable && (
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                        {source.detail}
                      </p>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {source.readable
                      ? "Read"
                      : source.status === "failed"
                        ? "Could not be read"
                        : "Not read"}
                  </span>
                </li>
              ))}
              {report.sources.length === 0 && (
                <li className="text-[13px] text-muted-foreground">No source was available.</li>
              )}
            </ul>
          </div>
          <div className="border-b border-border/70">
            <SectionGroup
              section={rubric}
              fallback="Evaluation signals were not computed for this run."
            />
            <SectionGroup
              section={evidenceInventory}
              fallback="No evidence inventory was recorded for this run."
            />
          </div>
          <SurfaceBody>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{report.disclaimer}</p>
          </SurfaceBody>
        </Surface>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- subviews */

/** Result string of one check, or an em dash when the check did not run. */
function findResult(checks: { id: string; result: string }[], id: string): string {
  return checks.find((check) => check.id === id)?.result ?? "—";
}

function DeploymentSection({ report }: { report: InspectionReport }) {
  const deployment = report.verdict.deployment;
  // A project type that needs no website still gets the surface, so the judge
  // reads why nothing was fetched instead of assuming a gap in the evidence.
  const hasWebEvidence =
    deployment.areas.length > 0 || deployment.rows.some((row) => row.status !== "could_not_verify");
  const address = deployment.http.finalUrl ?? deployment.url;

  return (
    <Surface id="analysis-deployment">
      <SurfaceHeader
        eyebrow="Deployment"
        title="Deployed application"
        description="What a public visitor can observe: reachability, response, resources, security signals and layout signals. Not a penetration test, and an unread check is never a failure."
        aside={
          <span className="text-[11px] text-muted-foreground">
            {address ?? (deployment.applicable ? "No deployed URL" : "Not required")}
          </span>
        }
      />
      {hasWebEvidence ? (
        <DeploymentDetail deployment={deployment} />
      ) : (
        <SurfaceBody>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {deployment.applicable
              ? (deployment.rows[0]?.detail ?? "No deployed application could be inspected.")
              : "This project type does not require a deployed website, so a missing URL is not counted against it. The repository, deck and submission were inspected instead."}
          </p>
        </SurfaceBody>
      )}
    </Surface>
  );
}

function DomainSection({
  id,
  section,
  label,
}: {
  id: string;
  section: InspectionSection | null;
  label: string;
}) {
  if (!section) return null;
  return (
    <Surface id={id}>
      <SurfaceHeader
        eyebrow="Technical analysis"
        title={label}
        description={section.summary}
        aside={<CheckStatusBadge status={section.status} />}
      />
      <div>
        <CheckList
          checks={section.checks}
          empty={section.empty ?? "Nothing could be checked here."}
        />
      </div>
    </Surface>
  );
}

function SectionGroup({
  section,
  fallback,
}: {
  section: InspectionSection | null;
  fallback: string;
}) {
  if (!section) {
    return <p className="px-5 py-4 text-[13px] text-muted-foreground">{fallback}</p>;
  }
  return (
    <div className="border-b border-border/70 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <h3 className="text-[13px] font-medium">{section.label}</h3>
        <CheckStatusBadge status={section.status} />
      </div>
      <p className="px-5 pb-2 pt-1 text-xs leading-relaxed text-muted-foreground">
        {section.summary}
      </p>
      <CheckList checks={section.checks} empty={section.empty ?? fallback} />
    </div>
  );
}
