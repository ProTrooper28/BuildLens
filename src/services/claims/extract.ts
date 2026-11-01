/**
 * Claim extraction → normalization → deduplication.
 *
 * Two claim sources are read here: the submitted PPT/PDF (already text-extracted
 * by the document pipeline) and the repository README. Both are the TEAM'S
 * WORDS, so everything this module produces starts at `unverified` — only the
 * registration step, which has inspected evidence, may set a verdict.
 */

import type { DocumentAnalysis, DocumentClaims } from "@/services/document/types";
import { isNearDuplicateClaim } from "@/services/evidence/bundle";
import type { ClaimCategory, ClaimSource, ClaimSourceRef, NormalizedClaim } from "./types";

/** Where a category came from, and how a claim of that kind is weighted. */
const CATEGORY_BY_GROUP: Record<keyof Omit<DocumentClaims, "summary" | "method">, ClaimCategory> = {
  problem: "problem",
  solution: "solution",
  features: "feature",
  technology: "technology",
  impact: "impact",
};

/** Heuristic confidence that a sentence is a real assertion, by group. */
const CONFIDENCE_BY_CATEGORY: Record<ClaimCategory, number> = {
  problem: 0.72,
  solution: 0.78,
  feature: 0.9,
  workflow: 0.9,
  technology: 0.92,
  architecture: 0.8,
  performance: 0.74,
  security: 0.86,
  impact: 0.6,
  description: 0.7,
};

/** README section headings → the claim category their lines describe. */
const CATEGORY_BY_HEADING: [RegExp, ClaimCategory][] = [
  [/^(features?|capabilities|what it does|highlights|functions?|modules?)$/i, "feature"],
  [
    /^(how it works|workflow|usage|user flow|demo|getting started|quick ?start|steps?)$/i,
    "workflow",
  ],
  [/^(tech|technology|tech ?stack|stack|built with|dependencies|languages?)$/i, "technology"],
  [/^(architecture|design|structure|system design|data model)$/i, "architecture"],
  [/^(performance|speed|benchmarks?|latency|optimi[sz]ation)$/i, "performance"],
  [/^(security|privacy|auth|authentication|authorization|compliance)$/i, "security"],
  [/^(problem|motivation|background|why)/i, "problem"],
  [/^(solution|approach|our (idea|approach)|overview|about|introduction|project)/i, "solution"],
  [/^(impact|results?|outcomes?|metrics|benefits|traction|roadmap|future)/i, "impact"],
];

function headingCategory(heading: string | null): ClaimCategory {
  if (!heading) return "feature";
  for (const [pattern, category] of CATEGORY_BY_HEADING) {
    if (pattern.test(heading.trim())) return category;
  }
  return "feature";
}

/** `Slide 6` for decks, `Page 6` for PDFs — matched on the page that holds it. */
function locationFor(
  claim: string,
  analysis: DocumentAnalysis,
  source: ClaimSource,
): string | null {
  const needle = claim.slice(0, 60).toLowerCase();
  const pages = analysis.extraction.pages;
  if (!needle || pages.length === 0) return null;
  const match = pages.find((page) => page.text.toLowerCase().includes(needle));
  if (!match) return null;
  const noun = source === "PDF" ? "Page" : "Slide";
  return `${noun} ${match.page}`;
}

/* ------------------------------------------------------------------- deck */

/**
 * Claims from the submitted PPT/PDF.
 *
 * `extractDocumentClaims` has already split the deck text into the team's own
 * assertions; here they are normalized into the shared claim format with a
 * source and, where the page text is stored, a slide/page reference.
 */
export function claimsFromDocument(analysis: DocumentAnalysis | null): NormalizedClaim[] {
  if (!analysis?.claims) return [];
  const claims = analysis.claims;
  const source: ClaimSource = analysis.extraction.kind === "pdf" ? "PDF" : "PPT";
  const out: NormalizedClaim[] = [];

  const push = (category: ClaimCategory, text: string | null, index: number) => {
    const value = (text ?? "").replace(/\s+/g, " ").trim();
    // Short entries are still claims ("React", "CSV export"); only junk is dropped.
    if (value.length < 4) return;
    out.push({
      id: `deck.${category}.${index}`,
      claim: value,
      source,
      sourceLocation: locationFor(value, analysis, source),
      sources: [{ source, location: locationFor(value, analysis, source) }],
      evidence: "",
      category,
      confidence: CONFIDENCE_BY_CATEGORY[category],
      verificationStatus: "unverified",
      verificationReason: "",
    });
  };

  if (claims.summary) push("description", claims.summary, 0);
  for (const [group, category] of Object.entries(CATEGORY_BY_GROUP) as [
    keyof Omit<DocumentClaims, "summary" | "method">,
    ClaimCategory,
  ][]) {
    (claims[group] ?? []).forEach((text, index) => push(category, text, index));
  }

  return out;
}

/* ------------------------------------------------------------------ README */

/** Assertion verbs — a README line without one is documentation, not a claim. */
const README_CLAIM =
  /\b(is|are|has|have|supports?|includes?|provides?|allows?|enables?|built with|integrates?|features?|works|deployed|offers?|handles?|delivers?|analy[sz]es|uses|runs)\b/i;

/** Imperative openers: "Use this skill…", "Run the setup…" — instructions, not claims. */
const README_INSTRUCTION =
  /^(use|using|run|runs|install|see|check|then|first|copy|clone|execute|please|read|edit|delete|download|visit|to|if|when|after|before|note|warning|tip|example|adding|add|start)\b/i;

const README_SKIP =
  /^(installation|install|usage|license|contributing|setup|getting started|requirements?|credits?|acknowledg\w+|changelog|roadmap|support|faq|table of contents)\b/i;

/** Section headings whose bullets are claims even without a linking verb. */
const README_CLAIM_SECTION =
  /^(features?|capabilities|what it does|highlights|architecture|tech(nology)?(\s*stack)?|stack|built with|security|privacy|performance|workflow|how it works|api|integrations?)\b/i;

const MAX_README_CLAIMS = 12;

/** Headings tell us what a line claims about; the text itself can override. */
function inferCategory(text: string, fromHeading: ClaimCategory): ClaimCategory {
  if (/\b(security|encrypt|oauth|authori[sz]|privacy|gdpr|xss|csrf)\b/i.test(text))
    return "security";
  if (/\b(performance|latency|lighthouse|benchmark|milliseconds|page speed|fast)\b/i.test(text))
    return "performance";
  if (/\b(architecture|microservice|serverless|monorepo|data model|schema)\b/i.test(text))
    return "architecture";
  if (
    /\b(react|next\.?js|vue|svelte|django|fastapi|python|typescript|javascript|node\.js|supabase|postgres|tailwind|vite|openai|tensorflow)\b/i.test(
      text,
    )
  )
    return "technology";
  return fromHeading;
}

/**
 * Claims the team wrote in the README.
 *
 * The README is a claim source like the deck — an assertion there is still the
 * team's word, never proof. Section headings are tracked so a line under
 * "Security" is filed as a security claim and can cite its section.
 */
export function claimsFromReadme(readme: { path: string; text: string } | null): NormalizedClaim[] {
  if (!readme?.text) return [];
  const out: NormalizedClaim[] = [];
  let heading: string | null = null;
  let inFence = false;

  for (const raw of readme.text.split("\n")) {
    if (out.length >= MAX_README_CLAIMS) break;
    const line = raw.trim();
    if (!line) continue;
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      heading = (headingMatch[1] ?? "").replace(/[#>`*_~]/g, "").trim();
      continue;
    }
    // Inline code, shell output and indented blocks are usage, not assertions.
    if (/`|\$\s|^ {4}/.test(line)) continue;

    const text = line
      .replace(/^([-*•▪◦●·]|\d+[.)])\s+/, "")
      .replace(/[#>`*_~[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 15 || text.length > 220) continue;
    // A fragment that stops mid-word (hard-wrapped README) is not a claim.
    const lastWord = (text.match(/[A-Za-z]+$/) ?? [""])[0];
    if (lastWord.length === 1 && !/[.!?]$/.test(text)) continue;
    // Outside a bullet, only finished sentences count.
    const wasBullet = /^([-*•▪◦●·]|\d+[.)])\s+/.test(line);
    if (!wasBullet && (!/^[A-Z]/.test(text) || !/[.!?]$/.test(text))) continue;
    if (/^https?:|^!|\]\(|badge|shields\.io|npm i |bun add|git clone/i.test(text)) continue;
    if (README_SKIP.test(text)) continue;
    if (README_INSTRUCTION.test(text)) continue;
    // A prose line needs a linking verb to be an assertion; a bullet under
    // "Features"/"Architecture"/… is a claim in its own right.
    const inClaimSection = heading !== null && README_CLAIM_SECTION.test(heading);
    if (!README_CLAIM.test(text) && !(wasBullet && inClaimSection)) continue;
    if (out.some((entry) => entry.claim === text)) continue;

    const category = inferCategory(text, headingCategory(heading));
    const location = heading ? `${readme.path} — ${heading}` : readme.path;
    out.push({
      id: `readme.${out.length}`,
      claim: text,
      source: "README",
      sourceLocation: location,
      sources: [{ source: "README", location }],
      evidence: "",
      category,
      confidence: CONFIDENCE_BY_CATEGORY[category] - 0.05,
      verificationStatus: "unverified",
      verificationReason: "",
    });
  }

  return out;
}

/* ----------------------------------------------------------- deduplication */

/**
 * Merge the same statement found in several places (deck, README, submission
 * form) into ONE claim carrying every source — the judge sees one row with
 * "PPT Slide 5 + README" rather than two identical rows.
 */
export function dedupeClaims(claims: readonly NormalizedClaim[]): NormalizedClaim[] {
  const out: NormalizedClaim[] = [];
  for (const claim of claims) {
    const existing = out.find(
      (entry) => entry.claim === claim.claim || isNearDuplicateClaim(entry.claim, claim.claim),
    );
    if (existing) {
      for (const source of claim.sources) {
        const known = existing.sources.some(
          (entry) => entry.source === source.source && entry.location === source.location,
        );
        if (!known) existing.sources.push(source);
      }
      // Keep the sharper verdict if either copy was already verified.
      if (existing.verificationStatus === "unverified") {
        existing.verificationStatus = claim.verificationStatus;
        existing.verificationReason = claim.verificationReason;
        existing.evidence = claim.evidence;
      }
      continue;
    }
    out.push({ ...claim, sources: claim.sources.map((source) => ({ ...source })) });
  }
  return out;
}
