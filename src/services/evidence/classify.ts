/**
 * Claim classification — what is a claim, what is not, and what it is about.
 *
 * The rule this file exists to enforce:
 *
 *   CANDIDATE SAID IT  ≠  BUILDLENS VERIFIED IT
 *
 * A deck contains two very different kinds of text. Some of it is the candidate
 * describing what they built (claims — worth checking); the rest is metadata
 * ("Team ID: 176743"), title-page banners ("SMART INDIA HACKATHON 2026") and
 * diagram labels ("GOES TO", "SENDS") that no evidence source can or should
 * verify.
 *
 * Metadata is never a claim, never a warning and never a finding. It is
 * reported separately as CANDIDATE-PROVIDED, with the place it was read from,
 * so a judge can see it without BuildLens ever implying it checked it.
 *
 * Everything here is deterministic and offline.
 */

import type { CandidateFact, ClaimCategory, ClaimType } from "./types";

export type { CandidateFact, ClaimType };


/* ------------------------------------------------------------- classifiers */

/**
 * Explicit metadata cues. These lines identify the submission or the event —
 * they are not assertions about the product.
 */
const METADATA_CUE =
  /^(team\s*(id|no\.?|number|name)?|hackathon|hack-?a-?thon|hackfest|codefest|event|title\s*page|submitted\s+by|submission\s*(id|code|number)|college|university|institute|department|dept|branch|roll\s*(no\.?|number)|problem\s+statement\s*(id|code|no\.?)|ps\s*(id|code|no\.?)|theme|track|category|contact|email|phone|date|venue|mentor|guide)\b/i;

/** A deck banner naming the event: "SMART INDIA HACKATHON 2026". */
const EVENT_BANNER =
  /\b(smart\s+india|hackathon|hack-?a-?thon|hackfest|codefest|ideathon|make-?a-?thon)\b/i;

/** Label/value pairs that are plainly metadata: "Team ID - 176743". */
const METADATA_PAIR =
  /^(team|team\s*(id|name)|submission|problem\s+statement|ps|college|university|department|branch|roll|category|theme|track)\b[^a-z]{0,3}[\w .()-]{1,60}$/i;

/** Diagram / flow labels: connectors, not functionality. */
const FLOW_LABEL =
  /^(goes\s+to|sends?|receives?|connects?\s+to|leads\s+to|then|input|output|inputs|outputs|step\s*\d+|stage\s*\d+|phase\s*\d+|next|previous|back|start|end|->|→|\+)$/i;

/** Bare identifiers: a number, a code, a date — never a claim. */
const BARE_ID = /^(\d{2,}|[A-Z]{2,}-?\d{2,}|[\w.+-]+@[\w.-]+\.\w+|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})$/;

/** A line that is mostly one all-caps banner. */
const SHOUTING = /^[^a-z]{8,}$/;

function words(text: string): string[] {
  return text
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Is this line candidate metadata (never a claim)?
 *
 * Deliberately conservative: it requires an explicit metadata cue, an event
 * banner, a flow label or a bare identifier. A short noun phrase like
 * "Browser Extension" or "Local CV" is a CLAIM even though it is short, because
 * the repository and the deployed page can actually show it.
 */
export function isCandidateMetadata(text: string): boolean {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return true;
  const stripped = clean.replace(/[.。:]+$/, "").trim();
  if (!stripped) return true;

  if (METADATA_CUE.test(stripped)) return true;
  if (METADATA_PAIR.test(stripped)) return true;
  if (METADATA_CUE.test(stripped.replace(/^[\s\-–—•·]+/, ""))) return true;
  if (BARE_ID.test(stripped)) return true;

  // Flow labels only when they are labels: short, no sentence structure.
  if (FLOW_LABEL.test(stripped) && words(stripped).length <= 4) return true;

  // A shouting banner with an event name ("SMART INDIA HACKATHON 2026").
  if (SHOUTING.test(stripped) && EVENT_BANNER.test(stripped)) return true;

  // "Title page" style banners: mostly caps, names an event or a document.
  if (
    words(stripped).length <= 8 &&
    /^[A-Z0-9\s&/-]+$/.test(stripped) &&
    EVENT_BANNER.test(stripped)
  ) {
    return true;
  }

  return false;
}

/** What this claim is about, from its wording and where it was found. */
export function claimTypeOf(text: string, category?: ClaimCategory): ClaimType {
  if (isCandidateMetadata(text)) return "metadata";
  const value = text.toLowerCase();

  if (
    /\b(secur\w*|encrypt\w*|auth\w*|privacy|vulnerab\w*|password|oauth|2fa|mfa|rbac|permissions?)\b/.test(
      value,
    ) ||
    /\b(faster|slow|latency|milliseconds?|throughput|performance|scalab\w*|optimi[sz]\w*|uptime|reliab\w*|\d+\s*%)\b/.test(
      value,
    )
  ) {
    return "security_performance";
  }

  if (category === "problem") return "problem";
  if (category === "solution") return "solution";
  if (category === "impact") return "impact";
  if (category === "features") return "feature";
  if (category === "technology") return "technology";

  if (/\b(users? can|allows?|enables?|lets?|supports?|offers?|provides?|features?|modules?|works?)\b/.test(value)) {
    return "feature";
  }
  if (/\b(react|vue|svelte|next\.?js|node\.?js|python|typescript|javascript|django|flask|fastapi|tensorflow|pytorch|supabase|firebase|postgres\w*|docker|kotlin|swift|flutter)\b/.test(value)) {
    return "technology";
  }
  // A short noun phrase ("Browser Extension", "Local CV") names a capability;
  // a sentence-shaped line is a general project claim.
  if (words(text).length <= 4 && !/[.!?]$/.test(text.trim())) return "feature";
  return "general";
}

/** Claim types that assert something the repository or the page can show. */
export function isSubstantiveClaim(type: ClaimType): boolean {
  return (
    type === "feature" ||
    type === "technology" ||
    type === "security_performance" ||
    type === "solution"
  );
}

/* --------------------------------------------------------------- metadata */

const LABELLED_FACT =
  /^(team\s*(?:id|name|no\.?|number)?|team|submission\s*(?:id|code|number)|problem\s+statement\s*(?:id|code|no\.?)?|ps\s*(?:id|code|no\.?)?|category|theme|track|college|university|institute|department|branch|roll\s*(?:no\.?|number)?|venue|date)\b\s*[-:–—]?\s*(.+)$/i;

const KNOWN_LABEL: { pattern: RegExp; label: string }[] = [
  { pattern: /^team\s*id/i, label: "Team ID" },
  { pattern: /^team\s*name|^team$/i, label: "Team name" },
  { pattern: /^submission/i, label: "Submission" },
  { pattern: /^problem\s+statement|^ps\b/i, label: "Problem statement" },
  { pattern: /^category|^track|^theme/i, label: "Category" },
  { pattern: /^college|^university|^institute/i, label: "Institution" },
  { pattern: /^department|^branch/i, label: "Department" },
];

function factLabel(rawLabel: string): string {
  for (const { pattern, label } of KNOWN_LABEL) if (pattern.test(rawLabel)) return label;
  const clean = rawLabel.replace(/\s+/g, " ").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * Candidate-provided facts from the submitted deck.
 *
 * Only explicit label/value pairs and event banners are taken — the same lines
 * `isCandidateMetadata` refuses to treat as claims. Nothing here is verified, so
 * every fact carries the place it was read from.
 */
export function candidateFactsFrom(
  pages: readonly { page: number; text: string }[] | null | undefined,
  fallbackTeam?: string | null,
): CandidateFact[] {
  const facts: CandidateFact[] = [];
  const seen = new Set<string>();
  const push = (label: string, value: string, source: string, page?: number) => {
    const clean = value.replace(/\s+/g, " ").replace(/[.;:]+$/, "").trim();
    if (clean.length < 2 || clean.length > 80) return;
    const key = `${label.toLowerCase()}:${clean.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    facts.push(page === undefined ? { label, value: clean, source } : { label, value: clean, source, page });
  };

  for (const page of pages ?? []) {
    const source = `PPT — slide ${page.page}`;
    for (const raw of (page.text ?? "").split(/\r?\n/)) {
      const line = raw.replace(/^[\s\-–—•·]+/, "").replace(/\s+/g, " ").trim();
      if (!line || line.length > 120) continue;
      const pair = line.match(LABELLED_FACT);
      if (pair) {
        push(factLabel(pair[1] ?? "Detail"), pair[2] ?? "", source, page.page);
        continue;
      }
      if (EVENT_BANNER.test(line) && (SHOUTING.test(line) || words(line).length <= 8)) {
        push("Event", line.replace(/[.:]+$/, ""), source, page.page);
      }
    }
  }

  if (fallbackTeam) push("Team name", fallbackTeam, "Submission form");
  return facts.slice(0, 12);
}
