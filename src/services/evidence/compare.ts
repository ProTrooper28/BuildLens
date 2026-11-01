/**
 * Deterministic claim → evidence comparison.
 *
 * This is the part a reviewer can audit: it never guesses. A claim is compared
 * with evidence that was actually READ, split by where it came from
 * (`EvidenceSegment`), and the result is one of four statuses:
 *
 *   supported           — implementation/config/runtime evidence states it
 *   partially_supported — part of it is backed, part is missing
 *   not_found           — sources were read and don't show it
 *   could_not_verify    — no verification source could be read, or the claim
 *                         itself cannot be decided by code (opinion, impact)
 *
 * Two rules carry most of the weight:
 *
 *   1. A README is a CLAIM SOURCE, never a verification source. Documentation
 *      segments are excluded from matching (unless the claim is literally about
 *      the documentation), so "the README says it exists" can never verify it.
 *   2. Words that only *describe* the artifact ("we implemented", "our
 *      platform") do not count as support on their own. Support needs the
 *      specific words of the claim, or a concept (authentication, AI, tests, …)
 *      backed by a named file, dependency, observation or visible page text —
 *      and even then anything specific the claim adds ("Google", "role-based")
 *      still has to be found, or the verdict drops to partial.
 *
 * Every status carries `evidenceRefs` (file paths / URLs / page numbers a judge
 * can open) and a plain-language `note` that distinguishes "missing" from
 * "false".
 */

import type { IngestionKind, IngestionOutcome } from "@/services/ingestion/types";
import {
  CLAIM_STATUS_DISCLAIMER,
  evidenceCounts,
  type ClaimCategory,
  type ClaimCheck,
  type ClaimEvidenceStatus,
  type ClaimKind,
  type ClaimNature,
  type ClaimSourceFinding,
  type ClaimType,
  type ClaimVerdict,
  type EvidenceBundle,
  type EvidenceSegmentKind,
  type EvidenceSourceReport,
} from "./types";
import { EVIDENCE_CONCEPTS, type EvidenceConcept } from "./concepts";

export interface ClaimInput {
  id: string;
  claim: string;
  category: ClaimCategory;
  /** What the claim is about — used for ordering and labels only. */
  kind?: ClaimKind;
  /** The judged vocabulary (feature, technology, impact, …). */
  claimType?: ClaimType;
  /** Slide/page numbers where the claim was found in the deck. */
  pageRefs?: number[];
  /** Where the candidate said it, e.g. `Candidate deck — slide 5`. */
  sourceRef?: string;
  /** Whether the claim can be decided at all (marketing / impact → no). */
  nature?: ClaimNature;
}

/** Sources allowed to verify a claim (the deck is not one of them). */
const VERIFICATION_SOURCES: IngestionKind[] = ["repository", "website"];

/** Observations that describe documentation rather than the implementation. */
const DOCUMENTATION_OBSERVATIONS = new Set(["repo.code.docs", "repo.readme.claims"]);

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "our",
  "their",
  "they",
  "them",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "will",
  "can",
  "could",
  "would",
  "should",
  "not",
  "but",
  "you",
  "your",
  "its",
  "it's",
  "using",
  "used",
  "use",
  "over",
  "more",
  "most",
  "than",
  "all",
  "any",
  "each",
  "also",
  "which",
  "what",
  "when",
  "where",
  "who",
  "how",
  "why",
  "been",
  "being",
  "about",
  "after",
  "before",
  "between",
  "during",
  "through",
  "per",
  "via",
  "allow",
  "allows",
  "able",
  "real",
  "time",
  "new",
  "own",
  "very",
  "just",
  "only",
  "one",
  "two",
  "us",
  "we",
  "i",
  "it",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "at",
  "as",
  "by",
  "or",
  "if",
  "is",
  "be",
  "do",
  "does",
  "done",
  "uses",
  "so",
  "such",
  "then",
  "there",
  "these",
  "those",
  "up",
  "out",
  "no",
  "yes",
]);

/**
 * Words that describe the artifact rather than a specific capability. They are
 * never allowed to carry a claim to SUPPORTED on their own: "we implemented X"
 * needs evidence for X, not for "implemented".
 */
const GENERIC_CLAIM_WORDS = new Set([
  "implement",
  "implementation",
  "implemented",
  "implementing",
  "build",
  "builds",
  "built",
  "building",
  "create",
  "creates",
  "created",
  "creating",
  "develop",
  "developed",
  "development",
  "add",
  "adds",
  "added",
  "provide",
  "provides",
  "provided",
  "offer",
  "offers",
  "included",
  "include",
  "includes",
  "support",
  "supports",
  "supported",
  "enable",
  "enables",
  "enabled",
  "allow",
  "allowed",
  "ensure",
  "ensures",
  "deliver",
  "delivers",
  "integrate",
  "integrates",
  "integrated",
  "incorporate",
  "work",
  "works",
  "feature",
  "features",
  "functionality",
  "capability",
  "capabilities",
  "system",
  "systems",
  "platform",
  "application",
  "applications",
  "app",
  "project",
  "solution",
  "solutions",
  "product",
  "tool",
  "tools",
  "service",
  "services",
  "website",
  "site",
  "page",
  "pages",
  "team",
  "based",
  "full",
  "complete",
  "ready",
  "main",
  "major",
  "core",
  "user",
  "users",
]);

/** A claim this specific is only worth quoting when the evidence repeats it. */
const MIN_QUOTE_OVERLAP = 2;

/** Code that is clearly not implemented yet: support, but only partial. */
const PLACEHOLDER =
  /\b(todo|not implemented|coming soon|placeholder|stub|dummy|mock|lorem ipsum|return null|for now|in a real (app|implementation|system))\b/i;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").trim();
}

/** Tiny plural fold so "portfolio" and "portfolios" compare equal. */
function stem(token: string): string {
  if (token.length > 5 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

/** A claim word, kept raw so explanations can quote it back in plain language. */
interface ClaimWord {
  raw: string;
  stem: string;
}

function wordList(value: string): ClaimWord[] {
  return normalize(value)
    .split(/[^a-z0-9%+#.]+/)
    .map((token) => token.replace(/^[.]+|[.]+$/g, ""))
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map((token) => ({ raw: token, stem: stem(token) }));
}

function tokens(value: string): string[] {
  return [...new Set(wordList(value).map((word) => word.stem))];
}

function numbers(value: string): string[] {
  return (value.match(/\d+(?:\.\d+)?%?/g) ?? []).map((number) => number.replace(/^0+(?=\d)/, ""));
}

function sentences(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length >= 20 && sentence.length <= 400);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/** Technology names: a stack claim is decided by whether the name is present. */
const TECHNOLOGY_WORDS = new Set([
  "react",
  "vue",
  "svelte",
  "angular",
  "next",
  "nuxt",
  "node",
  "express",
  "typescript",
  "javascript",
  "python",
  "django",
  "flask",
  "fastapi",
  "java",
  "kotlin",
  "swift",
  "flutter",
  "rust",
  "golang",
  "ruby",
  "rails",
  "php",
  "laravel",
  "spring",
  "graphql",
  "tailwind",
  "bootstrap",
  "postgres",
  "postgresql",
  "mysql",
  "mongo",
  "mongodb",
  "redis",
  "supabase",
  "firebase",
  "tensorflow",
  "pytorch",
  "docker",
  "kubernetes",
  "aws",
  "azure",
  "gcp",
  "vercel",
  "netlify",
  "expo",
  "android",
  "ios",
]);

/**
 * Technologies that occupy the same slot in a stack. Only used to prove a
 * CONTRADICTION: the repository declaring Vue while the deck claims React is
 * evidence against the claim, while the absence of a name alone never is.
 */
const TECHNOLOGY_FAMILIES: readonly (readonly string[])[] = [
  ["react", "vue", "svelte", "angular", "next", "nuxt", "solid"],
  ["node", "express", "fastify", "django", "flask", "fastapi", "rails", "laravel", "spring"],
  ["postgres", "postgresql", "mysql", "mongo", "mongodb", "redis", "sqlite"],
  ["tensorflow", "pytorch", "keras", "sklearn", "scikit"],
];

function familyOf(word: string): readonly string[] | null {
  for (const family of TECHNOLOGY_FAMILIES) if (family.includes(word)) return family;
  return null;
}

/* ------------------------------------------------------------------ units */

/**
 * One independently citable piece of evidence: a file, the dependency list,
 * the file listing, the deployed page or a structured finding — always with the
 * reference a judge can open.
 */
interface EvidenceUnit {
  source: IngestionKind;
  ref: string;
  kind: EvidenceSegmentKind;
  documentation: boolean;
  /** A file listing / index: good for ranking, never enough on its own. */
  weak: boolean;
  text: string;
}

function unit(
  source: IngestionKind,
  ref: string,
  kind: EvidenceSegmentKind,
  text: string,
): EvidenceUnit {
  return {
    source,
    ref,
    kind,
    documentation: kind === "documentation",
    weak: /file list/i.test(ref),
    text: text.trim(),
  };
}

/** Fallback for outcomes that were built without segments (tests, legacy). */
function fallbackUnits(outcome: IngestionOutcome): EvidenceUnit[] {
  const facts = (outcome.facts ?? []).join("\n");
  if (outcome.kind !== "repository") {
    const text = [outcome.text ?? "", facts].join("\n").trim();
    if (!text) return [];
    const kind: EvidenceSegmentKind = outcome.kind === "website" ? "runtime" : "documentation";
    return [unit(outcome.kind, sourceRef(outcome), kind, text)];
  }

  // Repository text carries the README verbatim ("README (path): …"). Split it
  // off: prose may state a feature, it may never verify one.
  const raw = outcome.text ?? "";
  const readmeMatch = raw.match(/README \(([\w./-]+)\):/);
  const split = readmeMatch ? raw.indexOf(readmeMatch[0]) : -1;
  const implementationText = `${split >= 0 ? raw.slice(0, split) : raw}\n${facts}`.trim();
  const units: EvidenceUnit[] = [];
  if (implementationText) {
    units.push(unit(outcome.kind, sourceRef(outcome), "implementation", implementationText));
  }
  if (split >= 0 && raw.slice(split).trim()) {
    const path = readmeMatch?.[1] ?? "README";
    units.push(unit(outcome.kind, `GitHub: ${path}`, "documentation", raw.slice(split)));
  }
  return units;
}

function segmentsOf(outcome: IngestionOutcome): EvidenceUnit[] {
  const segments = outcome.segments ?? [];
  if (segments.length === 0) return fallbackUnits(outcome);
  return segments
    .filter((segment) => segment.text.trim().length > 0)
    .map((segment) => unit(outcome.kind, segment.ref, segment.kind, segment.text));
}

/** Citation for a structured finding, e.g. `GitHub: src/auth/login.ts`. */
function observationRef(outcome: IngestionOutcome, evidence: string[]): string {
  const file = evidence.find((entry) =>
    /^(package\.json|[\w./+-]+\.(ts|tsx|js|jsx|mjs|py|go|rb|java|kt|swift|php|json|ya?ml|toml|txt|md|ino))(:\s|$)/i.test(
      entry,
    ),
  );
  if (file) return `GitHub: ${file.split(":")[0]}`;
  return sourceRef(outcome);
}

function observationUnits(outcome: IngestionOutcome): EvidenceUnit[] {
  return (outcome.observations ?? [])
    .filter(
      (observation) =>
        observation.status === "good" || observation.status === "info",
    )
    .map((observation) => {
      const kind: EvidenceSegmentKind =
        DOCUMENTATION_OBSERVATIONS.has(observation.id) ? "documentation" : outcome.kind === "repository" ? "implementation" : "runtime";
      const text = `${observation.label}. ${observation.result} ${observation.evidence.join(" ")}`;
      return unit(
        outcome.kind,
        observationRef(outcome, observation.evidence),
        kind,
        text,
      );
    })
    .filter((entry) => entry.text.trim().length > 0);
}

/** Where a source lives, as the judge sees it. */
function sourceRef(outcome: IngestionOutcome): string {
  if (outcome.kind === "website") return `Deployed page: ${outcome.url ?? "submitted URL"}`;
  const url = outcome.url ?? "";
  const providerPath = url.match(/(?:github|gitlab)\.com\/([^?#]+)/i)?.[1];
  if (providerPath) {
    const [owner = "", name = ""] = providerPath.split("/").filter(Boolean);
    const full = [owner, name].filter(Boolean).join("/").replace(/\.git$/, "");
    if (full) return `GitHub: ${full}`;
  }
  return `GitHub: ${url || "repository"}`;
}

/* -------------------------------------------------------------- matching */

interface UnitMatch {
  unit: EvidenceUnit;
  matched: Set<string>;
  missing: string[];
  coverage: number;
  numbersFound: number;
  quotes: string[];
}

function pickQuotes(text: string, matched: Set<string>, claimSize: number): string[] {
  const need = Math.min(MIN_QUOTE_OVERLAP, Math.max(1, claimSize));
  const scored = sentences(text)
    .map((sentence) => {
      const sentenceTokens = new Set(tokens(sentence));
      const overlap = [...matched].filter((token) => sentenceTokens.has(token)).length;
      return { sentence, overlap };
    })
    .filter((entry) => entry.overlap >= need)
    .sort((a, b) => b.overlap - a.overlap);
  return scored.slice(0, 2).map((entry) => entry.sentence);
}

function matchUnit(
  claimWords: ClaimWord[],
  claimNumbers: string[],
  unit: EvidenceUnit,
): UnitMatch {
  const haystack = normalize(unit.text);
  const haystackTokens = new Set(tokens(haystack));
  const matched = new Set(claimWords.filter((word) => haystackTokens.has(word.stem)).map((word) => word.stem));
  const missing = claimWords.filter((word) => !matched.has(word.stem)).map((word) => word.raw);
  const numbersFound = claimNumbers.filter((number) => haystack.includes(number)).length;

  return {
    unit,
    matched,
    missing,
    coverage: claimWords.length === 0 ? 0 : matched.size / claimWords.length,
    numbersFound,
    quotes: matched.size > 0 ? pickQuotes(unit.text, matched, claimWords.length) : [],
  };
}

/* -------------------------------------------------------------- concepts */

interface ConceptBacking {
  concept: EvidenceConcept;
  refs: string[];
  sources: IngestionKind[];
}

/**
 * Is this concept backed by something other than prose? Only good/info
 * observations, config dependencies, repository paths and visible page text
 * count — documentation never does.
 */
function findBacking(
  concept: EvidenceConcept,
  readable: readonly IngestionOutcome[],
  units: readonly EvidenceUnit[],
): ConceptBacking | null {
  const refs: string[] = [];
  const sources = new Set<IngestionKind>();

  for (const outcome of readable) {
    for (const observation of outcome.observations ?? []) {
      if (!concept.observationIds?.includes(observation.id)) continue;
      if (observation.status !== "good" && observation.status !== "info") continue;
      refs.push(observationRef(outcome, observation.evidence));
      sources.add(outcome.kind);
    }
  }

  for (const entry of units) {
    if (entry.documentation) continue;
    const matchesDependency = concept.dependencies?.test(entry.text) ?? false;
    const matchesPath =
      (concept.paths?.test(entry.ref) ?? false) || (concept.paths?.test(entry.text) ?? false);
    const matchesRuntime = concept.runtime?.test(entry.text) ?? false;

    const backed =
      (entry.kind === "config" && (matchesDependency || matchesPath)) ||
      (entry.kind === "implementation" && matchesRuntime) ||
      (entry.kind === "implementation" && matchesDependency) ||
      (entry.kind === "runtime" && matchesRuntime);
    if (!backed) continue;

    refs.push(entry.ref);
    sources.add(entry.source);
  }

  if (refs.length === 0) return null;
  return { concept, refs: unique(refs), sources: [...sources] };
}

/* ----------------------------------------------------------------- notes */

/** Human explanation for one status — always distinguishes “missing” from “false”. */
function noteFor(input: {
  status: ClaimEvidenceStatus;
  nature: ClaimNature;
  readSources: string[];
  gaps: string[];
  refs: string[];
  missing: string[];
  placeholder: boolean;
  /** Concepts the verdict leaned on — disclosed so inference is never hidden. */
  viaConcepts: string[];
}): string {
  const { status, nature, readSources, gaps, refs, missing, placeholder, viaConcepts } = input;
  const where = refs.length > 0 ? refs.join(", ") : readSources.join(", ") || "the sources that were read";
  const listed = unique(missing).slice(0, 4);
  const inferred =
    viaConcepts.length > 0
      ? ` Matched through the ${viaConcepts.join(", ")} ${viaConcepts.length === 1 ? "signal" : "signals"} in that evidence rather than a quoted sentence.`
      : "";

  if (nature === "subjective") {
    return "This is a marketing or opinion statement, so code and a public page cannot confirm it. It needs your own judgement and is not counted as a missing feature.";
  }
  if (nature === "unmeasurable") {
    return "This claim describes value or impact rather than something the system can show, so it could not be checked from the repository or the deployed page. It needs your own judgement and is not counted as a missing feature.";
  }

  switch (status) {
    case "supported":
      return `The evidence that was read (${where}) shows this directly — the implementation or the deployed page matches the claim.${inferred}`;
    case "partially_supported":
      return `Partly backed by ${where}${
        listed.length > 0 ? `, but ${listed.join(", ")} ${listed.length === 1 ? "was" : "were"} not found in the code or the page that was read` : ""
      }.${placeholder ? " What was found is a placeholder or unfinished stub, not finished work." : ""}${inferred}`;
    case "not_found":
      return `The sources that were read (${readSources.join(", ") || "none"}) do not show this. That is a gap in the evidence, not proof that the claim is false.`;
    case "could_not_verify":
    default:
      return gaps.length > 0
        ? `Could not verify: ${gaps.join(", ")} could not be read, so this claim is unchecked — not contradicted.`
        : "Could not verify: no repository or deployed site was available to check this claim.";
  }
}

/* ------------------------------------------------------------- comparison */

function baseCheck(claim: ClaimInput, nature: ClaimNature): ClaimCheck {
  return {
    id: claim.id,
    claim: claim.claim,
    category: claim.category,
    kind: claim.kind ?? "general",
    ...(claim.claimType ? { claimType: claim.claimType } : {}),
    status: "could_not_verify",
    verdict: "unverified",
    ...(claim.sourceRef ? { sourceRef: claim.sourceRef } : {}),
    sources: [],
    quotes: [],
    pageRefs: claim.pageRefs ?? [],
    evidenceRefs: [],
    nature,
    note: "",
  };
}

/**
 * The verdict a judge reads, from the status plus the two things that make
 * UNSUPPORTED and CONTRADICTED different from plain UNVERIFIED:
 *
 *   • a quantified claim whose figure appears nowhere is UNSUPPORTED — it made
 *     a measurable promise the evidence does not keep;
 *   • a claim the evidence actively conflicts with is CONTRADICTED.
 *
 * Everything else that was not backed stays UNVERIFIED, never “false”.
 */
function verdictFor(input: {
  status: ClaimEvidenceStatus;
  contradiction: string | null;
  quantified: boolean;
  numbersFound: number;
}): ClaimVerdict {
  if (input.contradiction) return "contradicted";
  if (input.status === "supported") return "verified";
  if (input.status === "partially_supported") return "partially_verified";
  if (input.status === "not_found" && input.quantified && input.numbersFound === 0) {
    return "unsupported";
  }
  return "unverified";
}

/** Compare every claim with every readable verification source. */
export function compareClaims(
  claims: readonly ClaimInput[],
  outcomes: readonly IngestionOutcome[],
): ClaimCheck[] {
  const readable = outcomes.filter(
    (outcome) => outcome.status === "ingested" && VERIFICATION_SOURCES.includes(outcome.kind),
  );
  const readSources = readable.map((outcome) => sourceLabel(outcome.kind));
  const gaps = outcomes
    .filter((outcome) => outcome.status !== "ingested")
    .map((outcome) => sourceLabel(outcome.kind));
  const lookupUnits = [
    ...readable.flatMap(segmentsOf),
    ...readable.flatMap(observationUnits),
  ];
  const searchedRefs = unique(readable.map(sourceRef));

  return claims.map((claim) => {
    const nature = claim.nature ?? "checkable";
    const base = baseCheck(claim, nature);

    const noEvidenceNote = () =>
      noteFor({
        status: "could_not_verify",
        nature,
        readSources,
        gaps,
        refs: [],
        missing: [],
        placeholder: false,
        viaConcepts: [],
      });

    if (nature !== "checkable") return { ...base, note: noEvidenceNote() };
    if (readable.length === 0) return { ...base, note: noEvidenceNote() };

    const claimWords = wordList(claim.claim);
    const claimNumbers = unique(numbers(claim.claim));

    // Nothing checkable in the wording itself — never a "missing feature".
    if (claimWords.length === 0 && claimNumbers.length === 0) {
      return { ...base, note: noEvidenceNote() };
    }

    const mentionsDocumentation = /\b(readme|documentation|docs)\b/i.test(claim.claim);
    const units = lookupUnits.filter((entry) => !entry.documentation || mentionsDocumentation);
    if (units.length === 0) {
      return {
        ...base,
        note: "Could not verify: the sources were reachable but returned no readable text, so this claim is unchecked — not contradicted.",
      };
    }

    /* Concepts: structured evidence for claims whose words never appear as-is. */
    const backings = EVIDENCE_CONCEPTS.filter((concept) => concept.claim.test(claim.claim))
      .map((concept) => findBacking(concept, readable, lookupUnits))
      .filter((entry): entry is ConceptBacking => entry !== null);
    const conceptCovered = new Set<string>();
    for (const backing of backings) {
      for (const word of claimWords) {
        if (backing.concept.covers.test(word.raw)) conceptCovered.add(word.stem);
      }
    }

    /* Per-unit token matching, best unit first. */
    const matches = units
      .map((entry) => matchUnit(claimWords, claimNumbers, entry))
      .sort((a, b) => b.coverage - a.coverage || b.numbersFound - a.numbersFound);
    const best = matches[0] ?? null;
    const implementationMatch =
      matches.find((entry) => entry.unit.kind !== "documentation") ?? null;

    const matched = new Set(best?.matched ?? []);
    for (const stemValue of conceptCovered) matched.add(stemValue);

    const coverage = claimWords.length === 0 ? 0 : matched.size / claimWords.length;
    const missingWords = claimWords.filter((word) => !matched.has(word.stem)).map((word) => word.raw);
    const substantiveMissing = missingWords.filter((word) => !GENERIC_CLAIM_WORDS.has(word));

    const numbersFound = unique(
      matches.flatMap((entry) =>
        claimNumbers.filter((number) => normalize(entry.unit.text).includes(number)),
      ),
    );

    const technologyWords = claimWords.filter((word) => TECHNOLOGY_WORDS.has(word.raw));
    const allText = normalize(units.map((entry) => entry.text).join("\n"));
    // Whole words only: "react" must not match inside "created".
    const evidenceWords = new Set(wordList(allText).map((word) => word.raw));
    const technologiesFound = technologyWords.filter((word) => evidenceWords.has(word.raw));
    const technologiesMissing = technologyWords.filter((word) => !evidenceWords.has(word.raw));

    const weak = best?.unit.weak ?? false;
    const placeholder = best ? PLACEHOLDER.test(best.unit.text) : false;
    const conceptBacked = backings.length > 0;

    let status: ClaimEvidenceStatus;

    // Nothing specific in the wording: this is a judgement call, not a miss.
    const nothingSpecific =
      claimWords.length > 0 && claimWords.every((word) => GENERIC_CLAIM_WORDS.has(word.raw));

    // A quantified claim whose figure appears nowhere readable is not partially
    // supported: the quantified part is simply not there.
    if (claimNumbers.length > 0 && numbersFound.length === 0) {
      status = "not_found";
    } else if (claimNumbers.length > 0 && numbersFound.length < claimNumbers.length) {
      status = "partially_supported";
    } else if (technologiesMissing.length > 0) {
      status = technologiesFound.length > 0 ? "partially_supported" : "not_found";
    } else if (nothingSpecific) {
      status = "could_not_verify";
    } else if (
      // SUPPORTED needs every specific word of the claim accounted for: the
      // generic wording ("we implemented", "our platform") never carries it.
      substantiveMissing.length === 0 &&
      matched.size > 0 &&
      !weak &&
      !placeholder &&
      (conceptBacked || coverage >= 0.55 || claimWords.length <= 3)
    ) {
      status = "supported";
    } else if (
      conceptBacked ||
      coverage >= 0.4 ||
      technologiesFound.length > 0 ||
      numbersFound.length > 0
    ) {
      status = "partially_supported";
    } else {
      status = "not_found";
    }

    // A file listing or a stub proves existence of a path, not of a feature.
    if (status === "supported" && (weak || placeholder)) status = "partially_supported";

    const refs = unique([
      ...backings.flatMap((entry) => entry.refs),
      ...(status === "supported" || status === "partially_supported"
        ? [
            ...(best && best.matched.size > 0 ? [best.unit.ref] : []),
            ...(implementationMatch && implementationMatch.matched.size > 0
              ? [implementationMatch.unit.ref]
              : []),
          ]
        : []),
    ]).slice(0, 4);

    const sources = unique([
      ...matches.filter((entry) => entry.matched.size > 0).map((entry) => entry.unit.source),
      ...backings.flatMap((entry) => entry.sources),
    ]);

    const quotes =
      status === "supported" || status === "partially_supported"
        ? unique(matches.flatMap((entry) => entry.quotes)).slice(0, 3)
        : [];

    /**
     * What THIS source showed, so the claim table has a real cell per source
     * instead of a copy of the overall verdict.
     */
    const findingFor = (kind: "repository" | "website"): ClaimSourceFinding => {
      const outcome = readable.find((entry) => entry.kind === kind);
      if (!outcome) return "not_checked";
      const unitsOfSource = units.filter(
        (entry) => entry.source === kind && !entry.documentation,
      );
      if (unitsOfSource.length === 0) return "not_checked";

      const hit = matches.find(
        (entry) => entry.unit.source === kind && !entry.unit.documentation && entry.matched.size > 0,
      );
      const backed = backings.some((entry) => entry.sources.includes(kind));
      if (!hit && !backed) return "not_found";

      // A number the claim promises has to appear in this source too.
      const sourceNumbers = claimNumbers.filter((number) =>
        unitsOfSource.some((entry) => normalize(entry.text).includes(number)),
      );
      if (claimNumbers.length > 0 && sourceNumbers.length < claimNumbers.length) return "partial";

      const sourceMissing = hit
        ? claimWords.filter(
            (word) => !GENERIC_CLAIM_WORDS.has(word.raw) && !hit.matched.has(word.stem),
          )
        : [];
      return status === "supported" && sourceMissing.length === 0 ? "found" : "partial";
    };

    /**
     * CONTRADICTED is deliberately narrow: it needs evidence that conflicts,
     * not evidence that is merely absent. Today that means the repository
     * declaring a different technology from the same slot as the claim
     * ("React" claimed, Vue declared, no React anywhere).
     */
    let contradiction: string | null = null;
    if (technologyWords.length > 0 && technologiesMissing.length > 0) {
      const repositoryWords = new Set(
        wordList(
          units
            .filter((entry) => entry.source === "repository" && !entry.documentation)
            .map((entry) => entry.text)
            .join(" "),
        ).map((word) => word.raw),
      );
      for (const absent of technologiesMissing) {
        const family = familyOf(absent.raw);
        if (!family) continue;
        const alternative = family.find((name) => name !== absent.raw && repositoryWords.has(name));
        if (alternative) {
          contradiction = `The repository declares ${alternative} instead of ${absent.raw}, which the claim states.`;
          break;
        }
      }
    }

    const verdict = verdictFor({
      status,
      contradiction,
      quantified: claimNumbers.length > 0,
      numbersFound: numbersFound.length,
    });

    const bySource: Partial<Record<"repository" | "website", ClaimSourceFinding>> =
      nature === "checkable"
        ? { repository: findingFor("repository"), website: findingFor("website") }
        : { repository: "not_checked", website: "not_checked" };

    const explanation =
      status === "could_not_verify" && nothingSpecific
        ? "This claim does not name anything checkable — only general wording — so it could not be verified from the sources. It needs your own judgement and is not counted as a missing feature."
        : noteFor({
            status,
            nature,
            readSources,
            gaps,
            refs,
            missing: substantiveMissing,
            placeholder,
            viaConcepts: backings.map((entry) => entry.concept.label),
          });

    return {
      ...base,
      status,
      verdict,
      bySource,
      contradiction,
      sources,
      quotes,
      evidenceRefs:
        status === "not_found"
          ? searchedRefs.length > 0
            ? searchedRefs
            : readSources
          : refs,
      note: contradiction ? `${explanation} ${contradiction}` : explanation,
    };
  });
}

function sourceLabel(kind: IngestionKind): string {
  if (kind === "repository") return "repository";
  if (kind === "website") return "deployed site";
  return "submitted document";
}

/** Canonical display order: the sources a judge checks first come first. */
const SOURCE_ORDER: Record<IngestionKind, number> = {
  repository: 0,
  website: 1,
  document: 2,
};

/** Map ingestion outcomes to the source reports the UI shows. */
export function sourcesFromOutcomes(outcomes: readonly IngestionOutcome[]): EvidenceSourceReport[] {
  const ordered = [...outcomes].sort(
    (a, b) => (SOURCE_ORDER[a.kind] ?? 99) - (SOURCE_ORDER[b.kind] ?? 99),
  );
  return ordered.map((outcome) => ({
    kind: outcome.kind,
    label:
      outcome.kind === "repository"
        ? "GitHub repository"
        : outcome.kind === "website"
          ? "Deployed website"
          : "PPT/PDF document",
    status: outcome.status,
    readable: outcome.status === "ingested",
    url: outcome.url ?? null,
    detail: outcome.detail,
    highlights: outcome.facts ?? [],
    observations: outcome.observations ?? [],
  }));
}

/** Build the full bundle: sources, per-claim statuses, gaps, counts. */
export function assembleBundle(
  claims: readonly ClaimInput[],
  outcomes: readonly IngestionOutcome[],
): EvidenceBundle {
  const sources = sourcesFromOutcomes(outcomes);
  const claimChecks = compareClaims(claims, outcomes);
  const gaps = sources
    .filter((source) => !source.readable)
    .map((source) => `${source.label}: ${source.detail}`);

  return {
    generatedAt: new Date().toISOString(),
    sources,
    claims: claimChecks,
    gaps,
    counts: evidenceCounts(claimChecks),
    disclaimer: CLAIM_STATUS_DISCLAIMER,
  };
}
