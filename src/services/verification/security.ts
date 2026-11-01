/**
 * Risk-based security assessment.
 *
 * The old model scored a project's security mostly on configuration hygiene, so
 * a missing `SECURITY.md` could weigh as much as a committed credential. That is
 * backwards. Here every finding carries an impact class and a severity:
 *
 *   exposure       a credential, key or secret can be read from the sources
 *   configuration  something that weakens the setup but exposes nothing on its own
 *   policy         documentation / automation recommendations (SECURITY.md, Dependabot)
 *
 * Only `exposure` can take a large amount of the score, and every policy finding
 * together is capped at a few points. Absence of findings is never reported as
 * “secure”: server-side behaviour was not tested.
 *
 * Secret values are never parsed out or displayed — evidence lines keep the file
 * path or the pattern label only.
 */

import type { EvidenceBundle, EvidenceObservation } from "@/services/evidence/types";
import type { SecurityAssessment, SecurityFinding, Severity } from "./types";

const POLICY_PENALTY_CAP = 5;

function severityOf(value: string): Severity {
  return value === "critical" || value === "high" || value === "medium" ? value : "low";
}

function findObservation(bundle: EvidenceBundle | null, id: string): EvidenceObservation | null {
  for (const source of bundle?.sources ?? []) {
    const match = (source.observations ?? []).find((observation) => observation.id === id);
    if (match) return match;
  }
  return null;
}

function readable(bundle: EvidenceBundle | null, kind: "repository" | "website"): boolean {
  return bundle?.sources.some((source) => source.kind === kind && source.readable) ?? false;
}

const EXPOSURE_TITLE =
  /(environment file|ssh private key|private key|certificate|key material|\.npmrc|credential|token|secret)/i;
const POLICY_TITLE =
  /(security policy|dependabot|renovate|dependency update automation|lockfile|archived)/i;

/**
 * Repository findings arrive as `"Title (severity) — detail"` evidence lines.
 * `kind` is decided by the title: exposure when it names a credential-bearing
 * file, policy when it names a recommendation.
 */
function repositoryFindings(observation: EvidenceObservation): SecurityFinding[] {
  return observation.evidence.flatMap((line, index) => {
    const match = line.match(/^(.*?)\s*\((critical|high|medium|low)\)\s*(?:—\s*)?(.*)$/i);
    if (!match) {
      // A finding line the analyzer did not label is still treated as a finding.
      return [
        {
          id: `repo.secret.${index}`,
          title: "Repository security finding",
          severity: "medium" as Severity,
          kind: "configuration" as const,
          detail: line,
          evidence: [line],
        },
      ];
    }
    const [, title = "", rawSeverity = "low", detail = ""] = match;
    const kind: SecurityFinding["kind"] = POLICY_TITLE.test(title)
      ? "policy"
      : EXPOSURE_TITLE.test(title)
        ? "exposure"
        : "configuration";
    return [
      {
        id: `repo.secret.${index}`,
        title: title.trim(),
        severity: severityOf(rawSeverity.toLowerCase()),
        kind,
        detail: detail.trim() || title.trim(),
        // The path is safe to show; the value behind it never is.
        evidence: [line.trim()],
      },
    ];
  });
}

export function assessSecurity(bundle: EvidenceBundle | null): SecurityAssessment {
  const findings: SecurityFinding[] = [];
  const limitations: string[] = [];

  const repoSecrets = findObservation(bundle, "repo.security.secrets");
  if (repoSecrets && repoSecrets.status !== "not_detected") {
    findings.push(...repositoryFindings(repoSecrets));
  }

  const siteSecrets = findObservation(bundle, "site.security.secrets");
  if (siteSecrets?.status === "critical") {
    findings.push({
      id: "site.secret",
      title: "Potential credential exposed in the served page",
      severity: "critical",
      kind: "exposure",
      detail:
        "A pattern matching an API key or token was found in the public HTML or inline scripts. BuildLens withholds the value.",
      evidence: siteSecrets.evidence.slice(0, 4),
    });
  }

  const headers = findObservation(bundle, "site.security.headers");
  if (headers?.status === "warning") {
    const missing = headers.evidence.filter((line) => /: not sent$/i.test(line)).length;
    findings.push({
      id: "site.headers",
      title: "Security headers missing",
      severity: "low",
      kind: "configuration",
      detail: `${missing} of ${headers.evidence.length} recommended response headers were not sent. This is hardening, not an exploitable flaw on its own.`,
      evidence: headers.evidence.filter((line) => /: not sent$/i.test(line)).slice(0, 6),
    });
  }

  const mixed = findObservation(bundle, "site.security.mixed_content");
  if (mixed?.status === "warning" || mixed?.status === "critical") {
    findings.push({
      id: "site.mixed",
      title: "Mixed content on the page",
      severity: mixed.status === "critical" ? "high" : "medium",
      kind: "configuration",
      detail: mixed.result,
      evidence: mixed.evidence.slice(0, 4),
    });
  }

  const serverSide = findObservation(bundle, "site.security.server_side");
  const repoServer = findObservation(bundle, "repo.security.server_side");
  if (serverSide || repoServer) {
    limitations.push(
      "Authorization, injection and data-exposure risks were not tested — this is a static and public-page inspection, not a penetration test.",
    );
  }
  if (!readable(bundle, "repository")) {
    limitations.push(
      "The repository could not be read, so committed credentials and configuration were not checked.",
    );
  }
  if (!readable(bundle, "website")) {
    limitations.push(
      "The deployed application could not be read, so secrets in served assets were not checked.",
    );
  }

  findings.sort((a, b) => order(a.severity) - order(b.severity));

  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  const exposureFindings = findings.filter((finding) => finding.kind === "exposure");
  const noSource = !readable(bundle, "repository") && !readable(bundle, "website");

  let score: number | null = null;
  if (!noSource) {
    let value = 100;
    let policyPenalty = 0;
    for (const finding of findings) {
      if (finding.kind === "exposure") {
        value -= finding.severity === "critical" ? 55 : finding.severity === "high" ? 35 : 12;
      } else if (finding.kind === "configuration") {
        value -= finding.severity === "high" ? 18 : finding.severity === "medium" ? 8 : 3;
      } else {
        policyPenalty += 1;
      }
    }
    value -= Math.min(POLICY_PENALTY_CAP, policyPenalty);
    score = Math.max(0, Math.min(100, Math.round(value)));
  }

  const criticalExposure = exposureFindings.some((finding) => finding.severity === "critical");
  const highExposure = exposureFindings.some((finding) => finding.severity === "high");

  const headline = noSource
    ? "Security could not be assessed — neither the repository nor the deployed page could be read."
    : criticalExposure
      ? "A credential appears to be exposed in the sources that were read — rotate it before anything else."
      : highExposure
        ? "A high-risk exposure was detected in the sources that were read."
        : exposureFindings.length > 0
          ? "A low-risk sensitive file was detected; no live credential pattern was confirmed."
          : findings.length > 0
            ? "No exposed credential was found. The findings below are hardening and policy items, not vulnerabilities."
            : "No obvious issue was detected in the inspected source. Server-side security was not tested.";

  return { score, findings, counts, headline, limitations };
}

function order(severity: Severity): number {
  return severity === "critical" ? 0 : severity === "high" ? 1 : severity === "medium" ? 2 : 3;
}
