/**
 * Heuristic claim extraction from deck text.
 *
 * Reads the extracted slide/page text and pulls out the assertions a hackathon
 * deck makes: the problem being solved, the proposed solution, key features,
 * technology/AI used, and claimed impact/results — plus a one-paragraph
 * summary of what the team says the project does.
 *
 * This is deliberately deterministic and offline (no model call): the output
 * is labelled `method: "heuristic"` everywhere it appears, and it is handed to
 * the evaluation pipeline as CLAIMS to verify — never as facts. A future LLM
 * pass can replace or enrich this and set `method: "llm"`; the shape stays.
 */

import { isCandidateMetadata } from "@/services/evidence/classify";
import {
  MAX_CLAIMS_PER_CATEGORY,
  MAX_CLAIM_CHARS,
  type ClaimCategoryKey,
  type DocumentClaims,
} from "./types";

type CategoryBuckets = Record<ClaimCategoryKey, string[]>;

const CATEGORY_PATTERNS: { key: ClaimCategoryKey; pattern: RegExp }[] = [
  {
    key: "problem",
    pattern:
      /^(the\s+)?(problem|challenge|pain\s*points?|why\s+(this|we)|motivation|background)\b/i,
  },
  {
    key: "solution",
    pattern:
      /^(the\s+)?(solution|our\s+approach|what\s+we\s*(built|made)|proposed|approach|the\s+idea|product\s+overview)\b/i,
  },
  {
    key: "features",
    pattern:
      /^(key\s+)?(features|capabilities|what\s+we\s+offer|modules?|highlights|demo\s+walkthrough)\b/i,
  },
  {
    key: "technology",
    pattern:
      /^(tech(nology|nologies)?(\s*(stack|overview))?|built\s+with|ai\s*(\/|&|and)\s*(ml|models?)|architecture)\b/i,
  },
  {
    key: "impact",
    pattern:
      /^(impact|results?|outcomes?|metrics|achievements|traction|benefits|advantages|future\s+(work|scope|plan))\b/i,
  },
];

/** Bullet/number prefixes decks use for list items. */
const BULLET_PREFIX = /^([•▪◦●·–—*+-]|\d+[.)]|[a-zA-Z][.)])\s+/;

/** Canonical display names for the technology dictionary scan. */
const TECHNOLOGY_DICTIONARY: { pattern: RegExp; display: string }[] = [
  { pattern: /\breact(\s?native)?\b/i, display: "React Native" },
  { pattern: /\breact\b/i, display: "React" },
  { pattern: /\bnext\.?js\b/i, display: "Next.js" },
  { pattern: /\bvue(\.js)?\b/i, display: "Vue" },
  { pattern: /\bsvelte\b/i, display: "Svelte" },
  { pattern: /\bangular\b/i, display: "Angular" },
  { pattern: /\bnode\.?js\b/i, display: "Node.js" },
  { pattern: /\bexpress(\.js)?\b/i, display: "Express" },
  { pattern: /\btypescript\b/i, display: "TypeScript" },
  { pattern: /\bjavascript\b/i, display: "JavaScript" },
  { pattern: /\bpython\b/i, display: "Python" },
  { pattern: /\bdjango\b/i, display: "Django" },
  { pattern: /\bflask\b/i, display: "Flask" },
  { pattern: /\bfastapi\b/i, display: "FastAPI" },
  { pattern: /\btensorflow\b/i, display: "TensorFlow" },
  { pattern: /\bpytorch\b/i, display: "PyTorch" },
  { pattern: /\bkeras\b/i, display: "Keras" },
  { pattern: /\bscikit-?learn\b/i, display: "scikit-learn" },
  { pattern: /\bnumpy\b/i, display: "NumPy" },
  { pattern: /\bpandas\b/i, display: "Pandas" },
  { pattern: /\bopenai\b|\bgpt-?\d?\b|\bchatgpt\b/i, display: "OpenAI / GPT" },
  { pattern: /\bllms?\b|large\s+language\s+models?/i, display: "LLMs" },
  { pattern: /\blangchain\b/i, display: "LangChain" },
  { pattern: /\bhugging\s?face\b/i, display: "Hugging Face" },
  { pattern: /\byolo\b/i, display: "YOLO" },
  { pattern: /\bopencv\b/i, display: "OpenCV" },
  { pattern: /\bstable\s+diffusion\b/i, display: "Stable Diffusion" },
  { pattern: /\bgemini\b/i, display: "Google Gemini" },
  { pattern: /\bclaude\b/i, display: "Claude" },
  { pattern: /\bsupabase\b/i, display: "Supabase" },
  { pattern: /\bfirebase\b/i, display: "Firebase" },
  { pattern: /\bpostgres(ql)?\b/i, display: "PostgreSQL" },
  { pattern: /\bmongo(db)?\b/i, display: "MongoDB" },
  { pattern: /\bmysql\b/i, display: "MySQL" },
  { pattern: /\bredis\b/i, display: "Redis" },
  { pattern: /\bgraphql\b/i, display: "GraphQL" },
  { pattern: /\brest\s?apis?\b/i, display: "REST APIs" },
  { pattern: /\bdocker\b/i, display: "Docker" },
  { pattern: /\bkubernetes\b/i, display: "Kubernetes" },
  { pattern: /\baws\b|amazon\s+web\s+services/i, display: "AWS" },
  { pattern: /\bgcp\b|google\s+cloud\b/i, display: "Google Cloud" },
  { pattern: /\bazure\b/i, display: "Azure" },
  { pattern: /\bvercel\b/i, display: "Vercel" },
  { pattern: /\bnetlify\b/i, display: "Netlify" },
  { pattern: /\bflutter\b/i, display: "Flutter" },
  { pattern: /\bswift\b/i, display: "Swift" },
  { pattern: /\bkotlin\b/i, display: "Kotlin" },
  { pattern: /\bjava\b(?!script)/i, display: "Java" },
  { pattern: /\bc#\b|\.net\b/i, display: "C# / .NET" },
  { pattern: /\brust\b/i, display: "Rust" },
  { pattern: /\bgo(lang)?\b/i, display: "Go" },
  { pattern: /\bsolidity\b/i, display: "Solidity" },
  { pattern: /\bethereum\b|\bsolana\b|\bweb3\b|\bblockchain\b/i, display: "Blockchain / Web3" },
  { pattern: /\bthree\.?js\b/i, display: "Three.js" },
  { pattern: /\bunity\b/i, display: "Unity" },
  { pattern: /\barduino\b/i, display: "Arduino" },
  { pattern: /\braspberry\s+pi\b/i, display: "Raspberry Pi" },
  { pattern: /\bbluetooth\b|\bble\b/i, display: "Bluetooth/BLE" },
  { pattern: /\blora\b/i, display: "LoRa" },
  { pattern: /\btailwind(css)?\b/i, display: "Tailwind CSS" },
  { pattern: /\bredux\b/i, display: "Redux" },
  { pattern: /\bspark\b|apache\s+spark/i, display: "Apache Spark" },
  { pattern: /\bkafka\b/i, display: "Kafka" },
];

/** Keywords that (with a number nearby) mark an impact/result sentence. */
const IMPACT_KEYWORDS =
  /(users?|customers?|patients?|students?|faster|quicker|reduc\w+|increas\w+|improv\w+|saves?|saved|accuracy|latency|throughput|cost|revenue|time|scalab\w+|real-?time|%)/i;

function clipClaim(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > MAX_CLAIM_CHARS ? `${clean.slice(0, MAX_CLAIM_CHARS - 1)}…` : clean;
}

function stripBullet(line: string): string {
  let out = line.trim();
  let previous: string;
  do {
    previous = out;
    out = out.replace(BULLET_PREFIX, "").trim();
  } while (out !== previous);
  return out;
}

/**
 * A short line that names one of our claim categories — either a standalone
 * header ("Problem") or an inline one ("The Problem: rising food waste");
 * inline headers return the content after the colon so it is not lost.
 */
function categoryOf(line: string): { key: ClaimCategoryKey; inline: string | null } | null {
  if (line.length > 60) return null;
  const candidate = line.replace(/:+\s*$/, "").trim();
  if (!candidate || /[.;]$/.test(candidate)) return null;
  for (const { key, pattern } of CATEGORY_PATTERNS) {
    if (pattern.test(candidate)) {
      const colon = line.indexOf(":");
      const inline = colon >= 0 ? line.slice(colon + 1).trim() : "";
      return { key, inline: inline || null };
    }
  }
  return null;
}

function pushClaim(buckets: CategoryBuckets, key: ClaimCategoryKey, raw: string): void {
  const claim = clipClaim(stripBullet(raw));
  if (claim.length < 3) return;
  // Metadata, title-page banners and diagram labels are the candidate's own
  // details, not claims: nothing can verify "Team ID 176743", so it must never
  // reach the verification pipeline or a judge warning.
  if (isCandidateMetadata(claim)) return;
  const bucket = buckets[key];
  if (bucket.some((existing) => existing.toLowerCase() === claim.toLowerCase())) return;
  if (bucket.length >= MAX_CLAIMS_PER_CATEGORY) return;
  bucket.push(claim);
}

function hasDigit(text: string): boolean {
  return /\d/.test(text);
}

/** Sentences that pair a number with an impact keyword — claimed results. */
function impactSentences(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 15 && sentence.length <= MAX_CLAIM_CHARS);
  const hits: string[] = [];
  for (const sentence of sentences) {
    if (!hasDigit(sentence)) continue;
    if (!IMPACT_KEYWORDS.test(sentence)) continue;
    const claim = clipClaim(sentence);
    if (hits.some((existing) => existing.toLowerCase() === claim.toLowerCase())) continue;
    hits.push(claim);
    if (hits.length >= MAX_CLAIMS_PER_CATEGORY) break;
  }
  return hits;
}

/**
 * A title-page capability label: "Browser Extension", "Local CV".
 *
 * Decks often open with the product's capability labels before any category
 * header. Short labels are claims (the repository can show them); sentences,
 * titles with a dash and metadata are not.
 */
function preambleLabel(line: string): boolean {
  const clean = stripBullet(line);
  if (clean.length < 3 || clean.length > 40) return false;
  const wordCount = clean.split(/\s+/).length;
  if (wordCount > 3) return false;
  if (/[.!?:;—–]/.test(clean)) return false;
  if (!/^[A-Za-z][\w &/+.-]*$/.test(clean)) return false;
  return !isCandidateMetadata(clean);
}

/** First meaningful lines before any category header → the deck's own pitch. */
function summaryFrom(preamble: string[], text: string): string | null {
  const joined = preamble
    .map(stripBullet)
    .filter((line) => line.length >= 8)
    .join(" ");
  const source = joined || text.replace(/\s+/g, " ").trim();
  if (!source) return null;
  const firstSentences = source.match(/(?:[^.!?]+[.!?]+){0,2}/)?.[0]?.trim() ?? "";
  const candidate = (firstSentences || source).slice(0, 300).trim();
  return candidate.length >= 8 ? clipClaim(candidate) : null;
}

/**
 * Extract the team's claims from extracted document text.
 *
 * Deterministic and total: any input (including empty) produces a well-formed
 * result whose empty lists mean "not stated in the document".
 */
export function extractDocumentClaims(text: string): DocumentClaims {
  const buckets: CategoryBuckets = {
    problem: [],
    solution: [],
    features: [],
    technology: [],
    impact: [],
  };
  const preamble: string[] = [];

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let current: ClaimCategoryKey | null = null;
  for (const line of lines) {
    const header = categoryOf(line);
    if (header) {
      current = header.key;
      if (header.inline) pushClaim(buckets, header.key, header.inline);
      continue;
    }
    if (current === null) {
      preamble.push(line);
      if (preambleLabel(line)) pushClaim(buckets, "features", line);
      continue;
    }
    pushClaim(buckets, current, line);
  }

  // Technology is also scanned across the whole deck — stacks get mentioned
  // anywhere, not just under a "Tech stack" header.
  const technology = TECHNOLOGY_DICTIONARY.filter(({ pattern }) => pattern.test(text)).map(
    ({ display }) => display,
  );
  if (technology.length > 0) {
    for (const item of technology) {
      if (buckets.technology.length >= MAX_CLAIMS_PER_CATEGORY) break;
      pushClaim(buckets, "technology", item);
    }
  }

  // Impact: claimed metrics from the impact section plus numeric claims
  // anywhere in the deck.
  for (const sentence of impactSentences(text)) {
    pushClaim(buckets, "impact", sentence);
  }

  return {
    summary: summaryFrom(preamble, text),
    problem: buckets.problem,
    solution: buckets.solution,
    features: buckets.features,
    technology: buckets.technology,
    impact: buckets.impact,
    method: "heuristic",
  };
}

/** Total number of extracted claim items (summary excluded). */
export function claimCount(claims: DocumentClaims | null): number {
  if (!claims) return 0;
  return (
    claims.problem.length +
    claims.solution.length +
    claims.features.length +
    claims.technology.length +
    claims.impact.length
  );
}
