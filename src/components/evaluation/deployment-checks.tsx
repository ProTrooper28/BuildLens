import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { Disclosure, EvidenceList, MetricGrid } from "@/components/evaluation/analysis-ui";
import { EvidenceBasisChip, StatusMark } from "@/components/evaluation/inspection-ui";
import { statusDotClass } from "@/components/evaluation/status-tone";
import { cn } from "@/lib/utils";
import { DEPLOYMENT_BASIS_LABELS, type DeploymentInspection } from "@/services/inspection/types";

/**
 * Deployment check, in two densities.
 *
 * The compact list answers what a judge asks first — is it up, does it serve a
 * page, is anything obviously wrong — in one glance. The detailed view keeps
 * every area, its measurements and the exact evidence behind them, with the
 * basis (observed / inferred / not detected / could not verify) on each finding.
 */

/** The five-line deployment check shown on the judge screen. */
export function DeploymentCheckBlock({
  deployment,
  submissionId,
  className,
}: {
  deployment: DeploymentInspection;
  submissionId: string;
  className?: string | undefined;
}) {
  // The spec's last line of the checklist: server-side security is never tested
  // from outside, so it is shown as unverified rather than omitted.
  const serverSide = deployment.areas
    .flatMap((area) => area.checks)
    .find((check) => check.id === "site.security.server_side");

  if (!deployment.applicable) {
    return (
      <div className={cn("rounded-lg border border-border bg-muted/20 px-4 py-3", className)}>
        <p className="text-[13px] font-medium">No deployed website is required for this project</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          BuildLens inspected the repository, the deck and the submission instead. A missing web URL
          is not counted against this project type.
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Deployment check
        </h3>
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
          {deployment.http.finalUrl ?? deployment.url ?? "No deployed URL"}
        </span>
      </div>

      <ul className="mt-2 divide-y divide-border/60">
        {deployment.rows.map((row) => (
          <li
            key={row.id}
            className="flex items-center justify-between gap-3 py-2"
            title={row.detail}
          >
            <span className="inline-flex min-w-0 items-center gap-2 text-[13px] text-foreground/90">
              <span
                className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass(row.status))}
                aria-hidden
              />
              {row.label}
            </span>
            <span className="shrink-0 text-right text-xs text-muted-foreground">{row.value}</span>
          </li>
        ))}
        {serverSide && (
          <li className="flex items-center justify-between gap-3 py-2" title={serverSide.detail}>
            <span className="inline-flex min-w-0 items-center gap-2 text-[13px] text-foreground/90">
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  statusDotClass(serverSide.status),
                )}
                aria-hidden
              />
              Server-side security
            </span>
            <span className="shrink-0 text-right text-xs text-muted-foreground">
              Could not verify
            </span>
          </li>
        )}
      </ul>

      <Link
        to="/evaluation/project/$id/analysis"
        params={{ id: submissionId }}
        hash="analysis-deployment"
        className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-primary transition-opacity hover:opacity-80"
      >
        View detailed deployment analysis
        <ArrowRight className="h-3 w-3" aria-hidden />
      </Link>
    </div>
  );
}

/** The structured deployment result for the detailed analysis page. */
export function DeploymentDetail({ deployment }: { deployment: DeploymentInspection }) {
  const response = deployment.rows.find((row) => row.id === "response");
  const redirects = deployment.http.redirects;

  return (
    <div>
      <div className="px-5 py-4">
        <MetricGrid
          items={[
            { label: "HTTP status", value: response?.value ?? "Not measured" },
            {
              label: "Response time",
              value:
                deployment.http.responseMs === null
                  ? "Not measured"
                  : `${deployment.http.responseMs} ms`,
            },
            { label: "Redirects", value: redirects === null ? "Not measured" : String(redirects) },
            { label: "Routes checked", value: String(deployment.routes.length) },
          ]}
        />
        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
          {deployment.http.finalUrl ?? deployment.url ?? "No URL"} · inspected{" "}
          {new Date(deployment.checkedAt).toLocaleString()}
          {deployment.http.https === null
            ? ""
            : deployment.http.https
              ? " · HTTPS"
              : " · plain HTTP"}
        </p>
      </div>

      {deployment.routes.length > 0 && (
        <div className="border-t border-border/70 px-5 py-4">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Routes and links requested
          </h3>
          <EvidenceList items={deployment.routes} limit={6} />
        </div>
      )}

      {deployment.areas.map((area) => (
        <div key={area.id} className="border-t border-border/70">
          <div className="flex items-center justify-between gap-3 px-5 pb-1 pt-3.5">
            <h3 className="text-[13px] font-medium">{area.label}</h3>
            <StatusMark status={area.status} />
          </div>
          <div>
            {area.checks.map((check) => (
              <Disclosure
                key={check.id}
                title={check.label}
                meta={`${check.value} · ${DEPLOYMENT_BASIS_LABELS[check.basis]}`}
                status={check.status}
              >
                <p className="text-[13px] leading-relaxed text-muted-foreground">{check.detail}</p>
                <EvidenceList items={check.evidence} limit={6} />
                <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <EvidenceBasisChip basis={check.basis} />
                  Confidence: {check.confidence}
                </p>
              </Disclosure>
            ))}
          </div>
        </div>
      ))}

      {deployment.resources.length > 0 && (
        <div className="border-t border-border/70 px-5 py-4">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Failed or oversized resources
          </h3>
          <EvidenceList items={deployment.resources} limit={6} />
        </div>
      )}

      {deployment.limitations.length > 0 && (
        <div className="border-t border-border/70 px-5 py-4">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            What was not tested
          </h3>
          <ul className="mt-2 space-y-1.5">
            {deployment.limitations.map((limitation, index) => (
              <li
                key={`${limitation}-${index}`}
                className="flex gap-2 text-[11px] leading-relaxed text-muted-foreground"
              >
                <span
                  className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50"
                  aria-hidden
                />
                <span className="min-w-0">{limitation}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
