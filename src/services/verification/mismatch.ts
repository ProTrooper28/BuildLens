/**
 * Document ↔ project mismatch detection.
 *
 * The submitted deck is a claim about a product. If it describes a *different*
 * product from the repository and the deployment, every claim in it is
 * worthless as evidence — so this runs before any scoring and can cap the
 * overall result.
 *
 * Only observable facts can raise a signal:
 *
 *   · a repository link in the deck that is not the submitted repository
 *   · a site domain in the deck that is not the submitted deployment
 *   · technology the deck names that the repository does not contain anywhere
 *   · a deck full of features of which none is supported by any source
 *   · a deck whose vocabulary barely overlaps what the sources contain
 *
 * Nothing is inferred from writing style, and a deck that simply says less than
 * the code is not a mismatch: the level stays `none` unless the evidence
 * contradicts the document.
 */

import type { ClaimCheck, EvidenceBundle } from "@/services/evidence/types";
import type { ProjectDetail } from "@/types/evaluation";
import type { DocumentMismatch, MismatchLevel, MismatchSignal } from "./types";

const MAX_DECK_CHARS = 20_000;

function deckTextOf(detail: ProjectDetail): string {
  const pages = (detail.presentationPages ?? []).map((page) => page.text ?? "").join("\n");
  const claims = detail.presentationClaims;
  const claimText = claims
    ? [
        claims.summary ?? "",
        ...(claims.problem ?? []),
        ...(claims.solution ?? []),
        ...(claims.features ?? []),
        ...(claims.technology ?? []),
        ...(claims.impact ?? []),
      ].join("\n")
    : "";
  return `${pages}\n${claimText}`.trim().slice(0, MAX_DECK_CHARS);
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** `github.com/owner/repo` → `owner/repo`. */
function repoSlugOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)/i);
  if (!match) return null;
  return `${match[1]}/${match[2]}`.replace(/\.git$/i, "").toLowerCase();
}

function wordsOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]+/g, " ")
      .split(/\s+/)
      .map((word) => word.replace(/^-+|-+$/g, ""))
      .filter((word) => word.length > 4),
  );
}

/**
 * Detect whether the deck describes the submitted project.
 *
 * `claims` is the bundle's claim list (already compared against the sources);
 * only deck-originated claims are used, so README lines never count against the
 * document.
 */
export function assessDocumentMismatch(input: {
  detail: ProjectDetail;
  bundle: EvidenceBundle | null;
  claims: readonly ClaimCheck[];
}): DocumentMismatch {
  const { detail, bundle, claims } = input;
  const deckText = deckTextOf(detail);
  const lowerDeck = deckText.toLowerCase();
  const signals: MismatchSignal[] = [];
  const evidence: string[] = [];

  const noMatch = (reason: string): DocumentMismatch => ({
    level: "none",
    score: 0,
    headline: reason,
    signals: [],
    evidence: [],
  });

  if (deckText.length < 60) {
    return noMatch(
      "No readable deck text, so the document could not be compared with the project.",
    );
  }

  const repoSource = bundle?.sources.find((source) => source.kind === "repository") ?? null;
  const siteSource = bundle?.sources.find((source) => source.kind === "website") ?? null;
  const repoRead = Boolean(repoSource?.readable);
  const siteRead = Boolean(siteSource?.readable);

  /* ---------------------------------------------------- repository links */

  const submittedRepo = repoSlugOf(detail.repoUrl);
  const deckRepos = [
    ...new Set(
      [...lowerDeck.matchAll(/github\.com\/([\w.-]+)\/([\w.-]+)/g)].map((match) =>
        `${match[1]}/${match[2]}`.replace(/\.git$/, ""),
      ),
    ),
  ];
  if (submittedRepo && deckRepos.length > 0) {
    const matching = deckRepos.filter((repo) => repo === submittedRepo);
    const others = deckRepos.filter((repo) => repo !== submittedRepo);
    if (matching.length === 0 && others.length > 0) {
      signals.push({
        id: "repo-link",
        label: "Deck links a different repository",
        detail: `The deck links ${others.map((repo) => `github.com/${repo}`).join(", ")}, but the submission's repository is github.com/${submittedRepo}.`,
        weight: 3,
        severity: "critical",
      });
      evidence.push(`Deck repository: github.com/${others[0]}`);
      evidence.push(`Submitted repository: github.com/${submittedRepo}`);
    }
  }

  /* -------------------------------------------------------- site domains */

  const submittedHost = hostOf(detail.demoUrl);
  const deckHosts = [
    ...new Set(
      [...lowerDeck.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)].map((match) =>
        match[1]!.replace(/^www\./, ""),
      ),
    ),
  ].filter((host) => !host.endsWith("github.com"));
  if (submittedHost && deckHosts.length > 0) {
    const matching = deckHosts.some(
      (host) =>
        host === submittedHost || submittedHost.endsWith(host) || host.endsWith(submittedHost),
    );
    if (!matching) {
      signals.push({
        id: "site-domain",
        label: "Deck names a different deployed site",
        detail: `The deck references ${deckHosts.slice(0, 3).join(", ")}, while the submitted deployment is ${submittedHost}.`,
        weight: 2,
        severity: "high",
      });
      evidence.push(`Deck domains: ${deckHosts.slice(0, 3).join(", ")}`);
      evidence.push(`Submitted deployment: ${submittedHost}`);
    }
  }

  /* ------------------------------------------------------ project identity */

  const nameWords = wordsOf(detail.name);
  if (nameWords.size > 0) {
    const mentioned = [...nameWords].some((word) => lowerDeck.includes(word));
    if (!mentioned && deckText.length >= 120) {
      signals.push({
        id: "project-name",
        label: "Deck never names the submitted project",
        detail: `The submitted project is called “${detail.name}”, which does not appear in the deck text that was read.`,
        weight: 1,
        severity: "medium",
      });
    }
  }

  /* --------------------------------------------------------------- stack */

  const deckTechnologies = [
    ...new Set([
      ...(detail.presentationClaims?.technology ?? []),
      ...claims.filter((claim) => claim.category === "technology").map((claim) => claim.claim),
    ]),
  ].filter((entry) => entry.trim().length > 1);

  if (deckTechnologies.length >= 2 && repoRead) {
    const stackText = [
      ...(repoSource?.highlights ?? []),
      ...(repoSource?.observations ?? []).flatMap((observation) => [
        observation.result,
        ...observation.evidence,
      ]),
    ]
      .join(" ")
      .toLowerCase();
    const found = deckTechnologies.filter((technology) =>
      stackText.includes(technology.toLowerCase().split(/\s+/)[0] ?? ""),
    );
    if (found.length === 0) {
      signals.push({
        id: "stack",
        label: "Deck's technology stack is absent from the repository",
        detail: `The deck names ${deckTechnologies.slice(0, 4).join(", ")}, and none of those appear in the repository's languages, frameworks or dependencies.`,
        weight: 2,
        severity: "high",
      });
      evidence.push(`Deck stack: ${deckTechnologies.slice(0, 4).join(", ")}`);
    }
  }

  /* ------------------------------------------------------ deck features */

  const deckClaims = claims.filter(
    (claim) => claim.id.startsWith("deck.") && (claim.nature ?? "checkable") === "checkable",
  );
  const supported = deckClaims.filter((claim) => claim.status === "supported").length;
  const absent = deckClaims.filter((claim) => claim.status === "not_found").length;

  if (deckClaims.length >= 2 && supported === 0 && absent >= 2) {
    signals.push({
      id: "unsupported-features",
      label: "None of the deck's claims is supported by any source",
      detail: `${deckClaims.length} checkable claims were extracted from the deck; none is backed by the repository or the deployed application, and ${absent} are absent from both.`,
      weight: 3,
      severity: "critical",
    });
    evidence.push(`Deck claims checked: ${deckClaims.length}`);
    evidence.push(`Supported: 0 · not found: ${absent}`);
  }

  /* --------------------------------------------------------- vocabulary */

  const evidenceCorpus = [
    detail.description ?? "",
    detail.solution ?? "",
    ...(repoSource?.highlights ?? []),
    ...(siteSource?.observations ?? []).map((observation) => observation.result),
  ].join(" ");
  const deckWords = wordsOf(deckText);
  const corpusWords = wordsOf(evidenceCorpus);
  if (deckWords.size >= 20 && corpusWords.size >= 20) {
    let shared = 0;
    for (const word of deckWords) if (corpusWords.has(word)) shared += 1;
    const overlap = shared / deckWords.size;
    if (overlap < 0.18) {
      signals.push({
        id: "vocabulary",
        label: "The deck and the project share almost no vocabulary",
        detail: `Only ${Math.round(overlap * 100)}% of the deck's distinctive words appear anywhere in the submission, repository or deployment.`,
        weight: 1,
        severity: "medium",
      });
      evidence.push(`Shared vocabulary: ${Math.round(overlap * 100)}%`);
    }
  }

  /* -------------------------------------------------------------- level */

  const total = signals.reduce((sum, signal) => sum + signal.weight, 0);
  const decisive = signals.some((signal) => signal.weight === 3);
  let level: MismatchLevel = "none";
  if (decisive || total >= 5) level = "major";
  else if (total >= 2) level = "possible";

  const score =
    level === "major"
      ? Math.min(95, 60 + total * 5)
      : level === "possible"
        ? Math.min(59, 25 + total * 8)
        : 0;

  const headline =
    level === "major"
      ? "The submitted document does not describe this project."
      : level === "possible"
        ? "The submitted document may describe a different version of this project."
        : "The document describes the submitted project.";

  return { level, score, headline, signals, evidence };
}

/** The reviewer-facing wording of a mismatch level. */
export const MISMATCH_LEVEL_LABELS: Record<MismatchLevel, string> = {
  none: "Document matches the project",
  possible: "Possible document mismatch",
  major: "Major document mismatch",
};
