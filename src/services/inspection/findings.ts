/**
 * Findings — what actually requires a judge's attention.
 *
 * The failure mode this replaces was noisy: every sentence a candidate wrote
 * became its own warning ("Request demonstration or code proof for: …"), so a
 * 20-slide deck produced 20 red lines and the real risks disappeared.
 *
 * Here the deterministic evidence is aggregated first and *then* prioritised:
 *
 *   • every finding has a severity (critical / high / medium / low / info);
 *   • findings of the same kind are grouped, with a count and up to three
 *     concrete examples instead of one line per claim;
 *   • severity follows risk, so a missing SECURITY.md can never outrank a
 *     committed secret or a contradicted core feature;
 *   • only critical / high / medium reach Judge Attention. Low and info stay in
 *     the detailed view.
 *
 * Nothing here invents a finding: every one traces back to a claim verdict, an
 * observation the source readers produced, or a source that could not be read.
 */

import {
  CLAIM_TYPE_LABELS,
  verdictOf,
  type ClaimCheck,
  type EvidenceBundle,
  type EvidenceObservation,
} from "@/services/evidence/types";
import { claimTypeOf, isSubstantiveClaim } from "@/services/evidence/classify";
import {
  FINDING_AREA_LABELS,
  type DeploymentInspection,
  type Finding,
  type FindingArea,
  type FindingSeverity,
  type ProjectType,
} from "./types";

export type { Finding, FindingArea, FindingSeverity } from "./types";

/** Risk order: a security critical always sorts above a documentation gap. */
const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const AREA_RANK: Record<FindingArea, number> = {
  security: 0,
  claims: 1,
  deployment: 2,
  functionality: 3,
  performance: 4,
  code: 5,
  documentation: 6,
  evidence: 7,
};

/** Judge Attention is risk-based: only these severities appear by default. */
export const ATTENTION_SEVERITIES: readonly FindingSeverity[] = ["critical", "high", "medium"];

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function claimLabel(claim: ClaimCheck): string {
  const type = claim.claimType ?? claimTypeOf(claim.claim, claim.category);
  const source = claim.sourceRef ? ` (${claim.sourceRef})` : "";
  return `${clip(claim.claim, 90)}${source} — ${CLAIM_TYPE_LABELS[type].toLowerCase()}`;
}

/** A claim worth a judge's attention: checkable, and about the product. */
function isImportantClaim(claim: ClaimCheck): boolean {
  if (claim.nature && claim.nature !== "checkable") return false;
  const type = claim.claimType ?? claimTypeOf(claim.claim, claim.category);
  return isSubstantiveClaim(type);
}

function finding(input: Omit<Finding, "areaLabel">): Finding {
  return { ...input, areaLabel: FINDING_AREA_LABELS[input.area] };
}

/* ------------------------------------------------------------------ claims */

function claimFindings(bundle: EvidenceBundle | null): Finding[] {
  if (!bundle) return [];
  const claims = bundle.claims;
  const findings: Finding[] = [];

  const verdictGroups = (verdict: "contradicted" | "unsupported" | "unverified" | "partially_verified") =>
    claims.filter((claim) => verdictOf(claim) === verdict);

  const contradicted = verdictGroups("contradicted");
  if (contradicted.length > 0) {
    const core = contradicted.some(isImportantClaim);
    findings.push(
      finding({
        id: "claims.contradicted",
        severity: core ? "critical" : "high",
        area: "claims",
        title: `${contradicted.length} claim${contradicted.length === 1 ? "" : "s"} contradicted by the evidence`,
        summary:
          "The evidence that was read conflicts with what the team states, rather than merely being missing.",
        items: contradicted.slice(0, 3).map(claimLabel),
        count: contradicted.length,
        link: { section: "claims", label: "Review claims" },
      }),
    );
  }

  const unsupported = verdictGroups("unsupported").filter(isImportantClaim);
  if (unsupported.length > 0) {
    findings.push(
      finding({
        id: "claims.unsupported",
        severity: unsupported.length >= 2 ? "high" : "medium",
        area: "claims",
        title: `${unsupported.length} quantified claim${unsupported.length === 1 ? "" : "s"} without supporting evidence`,
        summary:
          "These claims state a measured result, but no number in the readable evidence supports the figure.",
        items: unsupported.slice(0, 3).map(claimLabel),
        count: unsupported.length,
        link: { section: "claims", label: "Review claims" },
      }),
    );
  }

  const unverified = verdictGroups("unverified").filter(isImportantClaim);
  if (unverified.length > 0) {
    const unchecked = unverified.filter((claim) => claim.status === "could_not_verify");
    const checked = unverified.length - unchecked.length;
    findings.push(
      finding({
        id: "claims.unverified",
        severity: checked > 0 ? "high" : "medium",
        area: "claims",
        title: `${unverified.length} claim${unverified.length === 1 ? "" : "s"} could not be verified`,
        summary:
          checked > 0
            ? "These claims are about things the repository or the deployed app can show, and the evidence that was read does not show them. Unverified is not the same as false."
            : "No readable source could check these claims, so they remain unverified rather than contradicted.",
        items: unverified.slice(0, 3).map(claimLabel),
        count: unverified.length,
        link: { section: "claims", label: "Review claims" },
      }),
    );
  }

  const partial = verdictGroups("partially_verified").filter(isImportantClaim);
  if (partial.length > 0) {
    findings.push(
      finding({
        id: "claims.partial",
        severity: "low",
        area: "claims",
        title: `${partial.length} claim${partial.length === 1 ? "" : "s"} partially supported`,
        summary: "Part of each claim is backed by the evidence; the rest was not found.",
        items: partial.slice(0, 3).map(claimLabel),
        count: partial.length,
        link: { section: "claims", label: "Review claims" },
      }),
    );
  }

  return findings;
}

/* ------------------------------------------------------------- observations */

function observationFindings(bundle: EvidenceBundle | null): Finding[] {
  if (!bundle) return [];
  const findings: Finding[] = [];
  const observations = bundle.sources.flatMap((source) => source.observations ?? []);

  const byArea = (area: EvidenceObservation["area"]) =>
    observations.filter((observation) => observation.area === area);

  const security = byArea("security");
  const securityCritical = security.filter((observation) => observation.status === "critical");
  if (securityCritical.length > 0) {
    findings.push(
      finding({
        id: "security.critical",
        severity: "critical",
        area: "security",
        title:
          securityCritical.length === 1
            ? securityCritical[0]!.label
            : `${securityCritical.length} critical security findings`,
        summary:
          "A committed secret or an exposed credential was found in a public source. Secrets in a repository stay exposed even after they are deleted.",
        items: securityCritical.flatMap((observation) => observation.evidence.slice(0, 2)).slice(0, 3),
        count: securityCritical.length,
        link: { section: "security", label: "View security" },
      }),
    );
  }

  const securityWarnings = security.filter((observation) => observation.status === "warning");
  if (securityWarnings.length > 0) {
    findings.push(
      finding({
        id: "security.warning",
        severity: "medium",
        area: "security",
        title:
          securityWarnings.length === 1
            ? securityWarnings[0]!.label
            : `${securityWarnings.length} security signals need review`,
        summary: "Publicly observable security configuration is weaker than recommended.",
        items: securityWarnings.slice(0, 3).map((observation) => clip(observation.result, 110)),
        count: securityWarnings.length,
        link: { section: "security", label: "View security" },
      }),
    );
  }

  const deployment = byArea("accessibility");
  const unreachable = deployment.filter((observation) => observation.status === "critical");
  if (unreachable.length > 0) {
    findings.push(
      finding({
        id: "deployment.unreachable",
        severity: "critical",
        area: "deployment",
        title: "The deployed application could not be reached",
        summary:
          "The submitted URL did not serve a readable page, so nothing about the live application could be verified.",
        items: unreachable.slice(0, 3).map((observation) => clip(observation.result, 110)),
        count: unreachable.length,
        link: { section: "deployment", label: "View deployment" },
      }),
    );
  }

  const deploymentWarnings = deployment.filter((observation) => observation.status === "warning");
  if (deploymentWarnings.length > 0) {
    findings.push(
      finding({
        id: "deployment.warning",
        severity: "high",
        area: "deployment",
        title: "The deployed application has a significant issue",
        summary: "The page was reached, but something a judge would notice is wrong.",
        items: deploymentWarnings.slice(0, 3).map((observation) => clip(observation.result, 110)),
        count: deploymentWarnings.length,
        link: { section: "deployment", label: "View deployment" },
      }),
    );
  }

  const performance = byArea("performance").filter((observation) => observation.status === "warning");
  const performanceCritical = byArea("performance").filter(
    (observation) => observation.status === "critical",
  );
  if (performance.length + performanceCritical.length > 0) {
    const all = [...performanceCritical, ...performance];
    findings.push(
      finding({
        id: "performance.slow",
        severity: performanceCritical.length > 0 ? "high" : "medium",
        area: "performance",
        title:
          all.length === 1
            ? `Performance: ${clip(all[0]!.label.toLowerCase(), 60)}`
            : `${all.length} performance measurements are outside the recommended range`,
        summary: "Measured response or asset behaviour was slower than a judge should accept without comment.",
        items: all.slice(0, 3).map((observation) => clip(observation.result, 110)),
        count: all.length,
        link: { section: "performance", label: "View performance" },
      }),
    );
  }

  const functionality = byArea("functionality").filter(
    (observation) => observation.status === "warning" || observation.status === "critical",
  );
  if (functionality.length > 0) {
    findings.push(
      finding({
        id: "functionality.issue",
        severity: "high",
        area: "functionality",
        title:
          functionality.length === 1
            ? `Functionality: ${clip(functionality[0]!.label.toLowerCase(), 60)}`
            : `${functionality.length} functionality problems were observed`,
        summary: "Something the team's claims depend on did not work when the public interface was read.",
        items: functionality.slice(0, 3).map((observation) => clip(observation.result, 110)),
        count: functionality.length,
        link: { section: "functionality", label: "View functionality" },
      }),
    );
  }

  return findings;
}

/* ------------------------------------------------------- code & docs (low) */

function qualityFindings(bundle: EvidenceBundle | null): Finding[] {
  if (!bundle) return [];
  const observations = bundle.sources.flatMap((source) => source.observations ?? []);
  const findings: Finding[] = [];

  const docs = observations.find((observation) => observation.id === "repo.code.docs");
  if (docs?.status === "warning") {
    findings.push(
      finding({
        id: "documentation.readme",
        severity: "low",
        area: "documentation",
        title: "No README was found",
        summary:
          "Documentation quality is a minor point next to security and functionality; it is listed so the judge can mention it, not to outrank real risks.",
        items: [clip(docs.result, 110)],
        count: 1,
        link: { section: "repository", label: "View repository" },
      }),
    );
  }

  const tests = observations.find((observation) => observation.id === "repo.code.tests");
  if (tests?.status === "warning") {
    findings.push(
      finding({
        id: "code.tests",
        severity: "low",
        area: "code",
        title: "No automated tests were found",
        summary: "Correctness claims rest on manual demonstration rather than a test suite.",
        items: [clip(tests.result, 110)],
        count: 1,
        link: { section: "repository", label: "View repository" },
      }),
    );
  }

  const quality = observations.find((observation) => observation.id === "repo.quality");
  if (quality?.status === "warning") {
    findings.push(
      finding({
        id: "code.quality",
        severity: "low",
        area: "code",
        title: "Code-quality signals are weak",
        summary: "Structural signals (file sizes, layout, duplication) suggest limited maintainability.",
        items: quality.evidence.slice(0, 3),
        count: 1,
        link: { section: "repository", label: "View repository" },
      }),
    );
  }

  return findings;
}

/* --------------------------------------------------------------- evidence */

function evidenceFindings(bundle: EvidenceBundle | null, type: ProjectType): Finding[] {
  if (!bundle) return [];
  const needed = (kind: "repository" | "website") => {
    if (kind === "website") {
      return type === "web_app" || type === "api_backend";
    }
    return type !== "other";
  };

  const unreadable = bundle.sources.filter(
    (source) =>
      (source.kind === "repository" || source.kind === "website") &&
      !source.readable &&
      needed(source.kind),
  );
  if (unreadable.length === 0) return [];

  return [
    finding({
      id: "evidence.unreadable",
      severity: "medium",
      area: "evidence",
      title:
        unreadable.length === 1
          ? `${unreadable[0]!.label} could not be read`
          : `${unreadable.length} evidence sources could not be read`,
      summary:
        "A source this project type depends on was unavailable, so part of the submission is unverified. That is a gap in the evidence, not a finding against the team.",
      items: unreadable.slice(0, 3).map((source) => clip(source.detail, 110)),
      count: unreadable.length,
      link: { section: "evidence", label: "View evidence" },
    }),
  ];
}

/* ---------------------------------------------------------------- assembly */

export function buildFindings(input: {
  bundle: EvidenceBundle | null;
  deployment: DeploymentInspection | null;
  type: ProjectType;
}): Finding[] {
  const findings = [
    ...claimFindings(input.bundle),
    ...observationFindings(input.bundle),
    ...qualityFindings(input.bundle),
    ...evidenceFindings(input.bundle, input.type),
  ];

  // Deployment rows that are separate from the observations (HTTP, HTTPS,
  // mobile) so a flat "offline" row also becomes a finding.
  if (input.deployment?.applicable) {
    const offline = input.deployment.rows.find(
      (row) => row.id === "availability" && row.status === "critical",
    );
    if (offline && !findings.some((entry) => entry.id === "deployment.unreachable")) {
      findings.push(
        finding({
          id: "deployment.offline",
          severity: "critical",
          area: "deployment",
          title: "Deployment is not reachable",
          summary: offline.detail,
          items: [offline.value],
          count: 1,
          link: { section: "deployment", label: "View deployment" },
        }),
      );
    }
  }

  return findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      AREA_RANK[a.area] - AREA_RANK[b.area] ||
      b.count - a.count,
  );
}

/** The findings a judge should see without opening anything. */
export function attentionFindings(findings: readonly Finding[]): Finding[] {
  return findings.filter((entry) => ATTENTION_SEVERITIES.includes(entry.severity));
}

/** Severity counts, for the "3 issues require review" line. */
export function severityCounts(findings: readonly Finding[]): Record<FindingSeverity, number> {
  const counts: Record<FindingSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const entry of findings) counts[entry.severity] += 1;
  return counts;
}
