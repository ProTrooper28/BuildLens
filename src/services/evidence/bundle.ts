/**
 * Evidence bundle — the single object the AI judge and the judge UI share.
 *
 * Built from (a) the submission itself and (b) every ingestion outcome, so a
 * new evidence source only has to implement the ingestor interface: it shows up
 * here as a source and its text is compared against the claims automatically.
 *
 * Claims are curated, not scraped: a deck sentence is only treated as a claim
 * when it asserts something checkable (a feature, a technology, AI usage,
 * security, performance, an integration, functionality, scalability,
 * deployment or originality). Filler, headings and marketing adjectives are
 * dropped so the judge is not handed forty meaningless "claims".
 */

import type { EvaluationSubmission } from "@/services/evaluation-agent/schema";
import type { IngestionOutcome } from "@/services/ingestion/types";
import { assembleBundle, type ClaimInput } from "./compare";
import type {
  ClaimCategory,
  ClaimKind,
  ClaimNature,
  EvidenceBundle,
  EvidenceSourceReport,
} from "./types";

/** Longest claim list handed to the model/UI; keeps the payload reviewable. */
const MAX_CLAIMS = 24;

/** Claims shorter than this are only kept when they name a technology. */
const MIN_CLAIM_CHARS = 10;

const HEADINGS =
  /^(features?|capabilities|solution|problem|technology|tech stack|impact|results|demo|agenda|team|thank you|questions?|next steps|summary|introduction|overview|architecture|roadmap)$/i;

/**
 * What each claim is about. First match wins, so the specific categories come
 * before the generic ones.
 */
const KIND_PATTERNS: { kind: ClaimKind; pattern: RegExp }[] = [
  {
    kind: "ai",
    pattern:
      /\b(ai|a\.i\.|artificial intelligence|machine learning|ml|llms?|gpt|models?|neural|chatbot|computer vision|ocr|inference|dataset|training)\b/i,
  },
  {
    kind: "security",
    pattern:
      /\b(auth(?:entication|orisation|orization)?|oauth|sso|login|sign[- ]?in|jwt|encrypt\w*|secur\w*|privacy|rbac|permissions?|2fa|mfa|vulnerab\w*)\b/i,
  },
  {
    kind: "performance",
    pattern:
      /\b(performance|faster|fast|latency|speed|throughput|optimi[sz]\w*|cache|caching|real[- ]?time|milliseconds?|ms\b|seconds?)\b/i,
  },
  {
    kind: "integrations",
    pattern:
      /\b(integrat\w+|webhooks?|stripe|paypal|slack|discord|github|google|notion|twilio|sendgrid|shopify|third[- ]party)\b/i,
  },
  {
    kind: "scalability",
    pattern:
      /\b(scal(?:e|es|able|ability|ing)|thousands|millions|concurrent|enterprise|multi[- ]?tenant|high[- ]?volume)\b/i,
  },
  {
    kind: "deployment",
    pattern:
      /\b(deploy\w*|hosted|hosting|vercel|netlify|docker|kubernetes|aws|azure|gcp|production|cloud|ci\/cd)\b/i,
  },
  {
    kind: "functionality",
    pattern:
      /\b(users? can|allows?|enables?|lets?|supports?|works?|dashboard|upload|export|download|search|filters?|notifications?|scores?)\b/i,
  },
  {
    kind: "originality",
    pattern: /\b(novel|first[- ]of[- ]its[- ]kind|unique|original|patent\w*|unlike|breakthrough)\b/i,
  },
  {
    kind: "features",
    pattern: /\b(features?|capabilit\w+|modules?|includes?|provides?|offers?)\b/i,
  },
  {
    kind: "technology",
    pattern:
      /\b(react|vue|svelte|next\.?js|node\.?js|typescript|javascript|python|django|flask|fastapi|java\b|kotlin|swift|flutter|go\b|rust|postgres\w*|mongo\w*|redis|supabase|firebase|tensorflow|pytorch|docker)\b/i,
  },
];

/** Reading order for the judge summary: the substantive claims come first. */
const KIND_PRIORITY: Record<ClaimKind, number> = {
  ai: 6,
  security: 6,
  features: 5,
  technology: 5,
  deployment: 4,
  functionality: 4,
  performance: 3,
  integrations: 3,
  scalability: 2,
  originality: 2,
  general: 1,
};

export function claimKindOf(claim: string): ClaimKind {
  for (const { kind, pattern } of KIND_PATTERNS) if (pattern.test(claim)) return kind;
  return "general";
}

/* ------------------------------------------------------------------ nature */

/** Marketing language: no amount of code can confirm or deny it. */
const MARKETING =
  /\b(seamless(ly)?|revolutionary|world[- ]class|best[- ]in[- ]class|cutting[- ]edge|state[- ]of[- ]the[- ]art|game[- ]chang\w+|disrupt\w+|industry[- ]leading|unparalleled|effortless(ly)?|delightful|blazing[- ]fast|lightning[- ]fast|next[- ]generation|intuitive|powerful|amazing|incredible|perfect)\b/i;

/** Value/impact statements with nothing measurable inside them. */
const IMPACT_ONLY =
  /\b(improve|improves|improving|empower|empowers|transform|transforms|changing|simplif\w+|help|helps|helping|productivity|livelihoods?|communities|society|better|easier|worthwhile|meaningful)\b/i;

/** Things an implementation or a page can actually show. */
const CONCRETE =
  /\b(api|apis|dashboard|database|upload|export|import|login|auth\w*|payments?|checkout|model|dataset|endpoint|integration|notifications?|search|filter|report|reports|chart|map|docker|deploy\w*|mobile|ios|android|extension|cli|sdk|webhook|real[- ]?time|websocket|encrypt\w*|https|tests?|ai|ml|llm|gpt|password|oauth|ci|automation|synchroni[sz]\w+|invoice|schedule|booking|scoring|tracking)\b/i;

/**
 * Can a judge decide this at all?
 *
 * Subjective and unmeasurable claims are reported as COULD NOT VERIFY with a
 * clear "judge it yourself" note — never as NOT FOUND, because the team did not
 * fail a check that could have existed.
 */
export function claimNatureOf(text: string): ClaimNature {
  if (MARKETING.test(text)) return "subjective";
  if (IMPACT_ONLY.test(text) && !CONCRETE.test(text) && !/\d/.test(text)) return "unmeasurable";
  return "checkable";
}

/* ----------------------------------------------------------------- dedupe */

function signature(value: string): Set<string> {
  const words = value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);
  return new Set(
    words.map((word) => {
      if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
      if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
      if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
      return word;
    }),
  );
}

/**
 * Same claim said twice (deck features vs description vs form), or the same
 * claim said with extra words. Single-word claims only dedupe on an exact
 * match, so "React" and "React Native" stay two claims.
 */
export function isNearDuplicateClaim(a: string, b: string): boolean {
  const left = normalize(a);
  const right = normalize(b);
  if (left === right) return true;
  const A = signature(a);
  const B = signature(b);
  const smaller = Math.min(A.size, B.size);
  if (smaller < 2) return false;
  let shared = 0;
  for (const word of A) if (B.has(word)) shared += 1;
  return shared / smaller >= 0.8;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Slide/page numbers whose extracted text actually contains the claim.
 *
 * Page previews are capped, so a claim can run past the stored text: an exact
 * substring match is the strong signal, and a word overlap of at least 60% is
 * the fallback. No match means no page reference — never a guessed page.
 */
function pageRefsFor(
  claim: string,
  pages: { page: number; text: string }[] | undefined,
): number[] {
  if (!pages || pages.length === 0) return [];
  const needle = normalize(claim);
  if (needle.length < 12) return [];
  const probe = needle.slice(0, 140);
  const words = [...new Set(needle.split(" ").filter((word) => word.length > 3))];
  const refs: number[] = [];
  for (const page of pages) {
    if (!page.text) continue;
    const haystack = normalize(page.text);
    const exact = haystack.includes(probe);
    const matched = words.filter((word) => haystack.includes(word)).length;
    const overlap = words.length >= 2 && matched / words.length >= 0.6 && matched >= 2;
    if (exact || overlap) refs.push(page.page);
    if (refs.length >= 4) break;
  }
  return refs;
}

/** Is this line worth a judge's attention as a claim at all? */
function isCheckableClaim(text: string, kind: ClaimKind): boolean {
  if (text.length < 3) return false;
  if (text.endsWith("?")) return false;
  if (HEADINGS.test(text.replace(/[.:]$/, "").trim())) return false;
  if (text.length >= MIN_CLAIM_CHARS) return true;
  // Short items are kept only when they name a technology ("React", "AWS").
  return kind === "technology" || kind === "ai";
}

function pushClaim(
  target: ClaimInput[],
  category: ClaimCategory,
  claim: string,
  idPrefix: string,
  index: number,
  pages: { page: number; text: string }[] | undefined,
): void {
  const text = claim.replace(/\s+/g, " ").trim();
  if (!text) return;
  if ([...new Set(text)].length < 3) return;
  if (target.some((entry) => isNearDuplicateClaim(entry.claim, text))) return;

  const kind = claimKindOf(text);
  if (!isCheckableClaim(text, kind)) return;

  target.push({
    id: `${idPrefix}.${index}`,
    claim: text.slice(0, 400),
    category,
    kind,
    nature: claimNatureOf(text),
    pageRefs: pageRefsFor(text, pages),
  });
}

/**
 * Every important claim in the submission, in one list.
 *
 * Order matters: the deck's own claims first (that is what a judge reads first),
 * then the form fields and declared technologies. When the list is over the cap
 * the substantive claims (AI, security, features, stack, deployment) survive and
 * the generic ones are dropped — order is preserved.
 */
export function claimsFromSubmission(submission: EvaluationSubmission): ClaimInput[] {
  const claims: ClaimInput[] = [];
  const deck = submission.presentation?.claims ?? null;
  const pages = submission.presentation?.pages ?? undefined;

  if (deck) {
    const groups: { category: ClaimCategory; items: string[] | undefined }[] = [
      { category: "problem", items: deck.problem },
      { category: "solution", items: deck.solution },
      { category: "features", items: deck.features },
      { category: "technology", items: deck.technology },
      { category: "impact", items: deck.impact },
    ];
    for (const group of groups) {
      (group.items ?? []).forEach((item, index) =>
        pushClaim(claims, group.category, item, `deck.${group.category}`, index, pages),
      );
    }
    if (deck.summary) {
      pushClaim(claims, "description", deck.summary, "deck.summary", 0, pages);
    }
  }

  if (submission.description) {
    pushClaim(claims, "description", submission.description, "submission.description", 0, pages);
  }
  if (submission.problemStatement) {
    pushClaim(claims, "problem", submission.problemStatement, "submission.problem", 0, pages);
  }
  if (submission.solution) {
    pushClaim(claims, "solution", submission.solution, "submission.solution", 0, pages);
  }
  (submission.technologies ?? []).forEach((technology, index) =>
    pushClaim(claims, "technology", technology, `submission.technology`, index, pages),
  );

  if (claims.length <= MAX_CLAIMS) return claims;

  // Keep the highest-value claims, in the order they were collected.
  // Claims that cannot be judged from code are kept last: they must never push
  // a checkable feature claim out of the list.
  const keep = new Set(
    claims
      .map((entry, position) => ({
        id: entry.id,
        position,
        weight:
          KIND_PRIORITY[entry.kind ?? "general"] * 100 +
          (/\d/.test(entry.claim) ? 10 : 0) +
          (entry.nature === "checkable" ? 0 : -150),
      }))
      .sort((a, b) => b.weight - a.weight || a.position - b.position)
      .slice(0, MAX_CLAIMS)
      .map((entry) => entry.id),
  );
  return claims.filter((entry) => keep.has(entry.id));
}

/** The submission form itself is always readable — it is what the team typed. */
function submissionSource(submission: EvaluationSubmission): EvidenceSourceReport {
  const highlights: string[] = [];
  if (submission.description) highlights.push("Project description provided.");
  if (submission.problemStatement) highlights.push("Problem statement provided.");
  if (submission.solution) highlights.push("Proposed solution provided.");
  if ((submission.technologies ?? []).length > 0) {
    highlights.push(`Declared technologies: ${(submission.technologies ?? []).join(", ")}.`);
  }
  if (submission.presentation?.claims) {
    highlights.push("Deck claims extracted from the submitted document.");
  }
  if (submission.notes) highlights.push("Reviewer notes attached.");
  if (submission.team) highlights.push(`Team: ${submission.team}.`);

  return {
    kind: "submission",
    label: "Submission form",
    status: "ingested",
    readable: true,
    url: null,
    detail: `The team's own submission text${submission.presentation?.name ? ` and deck (${submission.presentation.name})` : ""}.`,
    highlights,
    observations: [],
  };
}

/**
 * Claims the team wrote in the README.
 *
 * The README is a claim source like the deck: these lines are compared with the
 * code and the deployed page, and the README itself is never the proof.
 * Only assertion-like lines of a reasonable size are taken, and at most a
 * handful — a README's install instructions are not claims.
 */
const README_CLAIM =
  /\b(is|are|has|have|supports?|includes?|provides?|allows?|enables?|built with|integrates?|features?|works|deployed|offers?|handles?|delivers?|analy[sz]e)\b/i;

/** Imperative openers: "Use this skill…", "Run the setup…" — instructions, not claims. */
const README_INSTRUCTION =
  /^(use|using|run|runs|install|see|check|then|first|copy|clone|execute|please|read|edit|delete|download|visit|to|if|when|after|before|note|warning|tip|example|adding|add|start)\b/i;

const README_SKIP =
  /^(installation|install|usage|license|contributing|setup|getting started|requirements?|credits?|acknowledg\w+|changelog|roadmap|support|faq|table of contents)\b/i;

const MAX_README_CLAIMS = 5;

export function claimsFromDocumentation(
  outcomes: readonly IngestionOutcome[],
): ClaimInput[] {
  const claims: ClaimInput[] = [];

  for (const outcome of outcomes) {
    if (outcome.kind !== "repository" || outcome.status !== "ingested") continue;
    for (const segment of outcome.segments ?? []) {
      if (segment.kind !== "documentation") continue;
      const lines = segment.text.split("\n");
      const clipped = segment.text.includes("… [truncated]");
      for (const [lineIndex, raw] of lines.entries()) {
        if (claims.length >= MAX_README_CLAIMS) break;
        // The README is clipped: its last line is a fragment, never a claim.
        if (clipped && lineIndex === lines.length - 1) continue;
        const trimmed = raw.trim();
        if (!trimmed) continue;
        // Inline code and shell lines are instructions, not claims.
        if (/`|\$\s|^ {4}/.test(trimmed)) continue;
        const isBullet = /^([-*•]|\d+[.)])\s+/.test(trimmed);
        const text = trimmed
          .replace(/^([-*•]|\d+[.)])\s+/, "")
          .replace(/[#>`*_~\[\]]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (text.length < 15 || text.length > 220) continue;
        // A fragment that stops mid-word (hard-wrapped README) is not a claim.
        const lastWord = (text.match(/[A-Za-z]+$/) ?? [""])[0];
        if (lastWord.length === 1 && !/[.!?]$/.test(text)) continue;
        // A prose line only counts when it is a finished sentence.
        if (!isBullet) {
          if (!/^[A-Z]/.test(text)) continue;
          if (!/[.!?]$/.test(text)) continue;
        }
        if (/^https?:|^!|\]\(|badge|shields\.io|npm i |bun add|git clone/i.test(text)) continue;
        if (README_SKIP.test(text.toLowerCase())) continue;
        if (README_INSTRUCTION.test(text)) continue;
        if (!README_CLAIM.test(text)) continue;
        const kind = claimKindOf(text);
        if (!isCheckableClaim(text, kind)) continue;
        const id = `readme.${claims.length}`;
        if (claims.some((entry) => entry.claim === text)) continue;
        claims.push({
          id,
          claim: text.slice(0, 400),
          category: "features",
          kind,
          nature: claimNatureOf(text),
          pageRefs: [],
        });
      }
    }
  }

  return claims;
}

/**
 * Build the bundle for one submission.
 *
 * `outcomes` is passed in (not fetched here) so the caller owns collection and
 * tests can inject evidence without network access.
 */
export function buildEvidenceBundle(
  submission: EvaluationSubmission,
  outcomes: readonly IngestionOutcome[],
): EvidenceBundle {
  const submissionClaims = claimsFromSubmission(submission);
  const documentationClaims = claimsFromDocumentation(outcomes);
  const claims = [...submissionClaims];
  for (const candidate of documentationClaims) {
    if (claims.length >= MAX_CLAIMS) break;
    if (claims.some((entry) => isNearDuplicateClaim(entry.claim, candidate.claim))) continue;
    claims.push(candidate);
  }
  const bundle = assembleBundle(claims, outcomes);
  return {
    ...bundle,
    sources: [submissionSource(submission), ...bundle.sources],
  };
}
