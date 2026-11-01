/**
 * Deployed-website evidence source.
 *
 * Fetches the submitted URL server-side (the browser cannot read cross-origin
 * HTML) and inspects what a public visitor can legitimately observe:
 *
 *   accessibility — reachability, HTTPS, redirects, HTTP errors, title
 *   functionality — page loads, visible text, interactive elements, broken links
 *   performance   — response time, HTML size, asset failures, large/slow assets
 *   security      — TLS, mixed content, security headers, obvious exposed secrets
 *   UX            — viewport/meta, language, image alt coverage, JS-only shells
 *
 * Everything is a measurement or a literal observation of the served page. No
 * Lighthouse-style score is invented, no page is exercised like a user would,
 * and any check that cannot be completed says so (`could_not_verify`) instead of
 * turning into a silent pass. Only public, non-intrusive HTTP requests are made
 * (the page plus a handful of its own same-origin assets and links).
 */

import type { EvaluationSubmission } from "@/services/evaluation-agent/schema";
import type { IngestionOutcome } from "../ingestion/types";
import { evidenceFetch } from "../ingestion/http";
import type { EvidenceObservation, EvidenceSegment, ObservationStatus } from "./types";

const REQUEST_TIMEOUT_MS = 12_000;
const SUB_REQUEST_TIMEOUT_MS = 5_000;
const MAX_HTML_CHARS = 400_000;
const MAX_TEXT_CHARS = 6_000;
const MAX_REDIRECTS = 4;
const MAX_RESOURCE_CHECKS = 5;
const MAX_LINK_CHECKS = 4;
/** Signals used to judge a measurement; they are thresholds, not a score. */
const SLOW_RESPONSE_MS = 2_500;
const LARGE_HTML_BYTES = 500_000;
const LARGE_ASSET_BYTES = 500_000;
const SLOW_ASSET_MS = 1_500;

/** Hostnames that would let a submission probe the server's own network. */
const PRIVATE_HOST =
  /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]|.*\.local$)/i;

const SECURITY_HEADERS: { key: string; label: string }[] = [
  { key: "content-security-policy", label: "Content-Security-Policy" },
  { key: "strict-transport-security", label: "Strict-Transport-Security" },
  { key: "x-content-type-options", label: "X-Content-Type-Options" },
  { key: "referrer-policy", label: "Referrer-Policy" },
  { key: "x-frame-options", label: "X-Frame-Options" },
  { key: "permissions-policy", label: "Permissions-Policy" },
];

/**
 * Secret patterns worth flagging when they appear in the *served* HTML or an
 * inline script. The matched value is never printed — only the pattern name.
 */
const SECRET_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: "Stripe secret key", pattern: /\bsk_(?:live|test)_[0-9A-Za-z]{16,}/ },
  { label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { label: "OpenAI-style key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}/ },
  { label: "Private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: "Slack token", pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}/ },
];

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… [truncated]` : text;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function firstMatch(html: string, pattern: RegExp): string | null {
  const match = pattern.exec(html);
  return match?.[1] ? decodeEntities(match[1]).trim() : null;
}

/**
 * Framework signals the delivered markup contains. These are literal strings in
 * the HTML (asset paths / generator meta), not guesses.
 */
function detectedFrameworks(html: string, scriptSources: string[]): string[] {
  const signals: { name: string; test: (source: string) => boolean }[] = [
    { name: "Next.js", test: (value) => value.includes("/_next/") },
    { name: "Nuxt", test: (value) => value.includes("/_nuxt/") },
    { name: "SvelteKit", test: (value) => value.includes("/_app/") },
    { name: "Gatsby", test: (value) => value.includes("gatsby") },
    { name: "React", test: (value) => value.includes("react") },
    { name: "Vue", test: (value) => value.includes("vue") },
    { name: "Angular", test: (value) => value.includes("angular") },
    { name: "Astro", test: (value) => value.includes("astro") },
    { name: "Vite", test: (value) => value.includes("/assets/") && value.endsWith(".js") },
  ];
  const haystack = `${html.slice(0, 200_000)} ${scriptSources.join(" ")}`.toLowerCase();
  return signals.filter((signal) => signal.test(haystack)).map((signal) => signal.name);
}

/* --------------------------------------------------------------- transport */

interface FetchStep {
  url: string;
  status: number;
  location: string | null;
  ms: number;
}

interface FetchOk {
  ok: true;
  response: Response;
  finalUrl: URL;
  steps: FetchStep[];
  totalMs: number;
}
interface FetchFailed {
  ok: false;
  reason: string;
  steps: FetchStep[];
  totalMs: number;
  blocked: boolean;
}

/**
 * Header access that works with a real `Headers` object and with the plain
 * objects the test/edge fetch implementations return.
 */
function headerOf(headers: Response["headers"] | null | undefined, name: string): string | null {
  if (!headers) return null;
  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === "function") {
    return (getter as (key: string) => string | null).call(headers, name) ?? null;
  }
  const record = headers as unknown as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()] ?? null;
}

function allHeaders(headers: Response["headers"] | null | undefined): Map<string, string> {
  const values = new Map<string, string>();
  if (!headers) return values;
  const forEach = (headers as { forEach?: unknown }).forEach;
  if (typeof forEach === "function") {
    (forEach as (fn: (value: string, key: string) => void) => void).call(
      headers,
      (value: string, key: string) => values.set(key.toLowerCase(), value),
    );
    return values;
  }
  for (const [key, value] of Object.entries(headers as unknown as Record<string, string>)) {
    values.set(key.toLowerCase(), String(value));
  }
  return values;
}

function isPrivate(raw: string): boolean {
  try {
    return PRIVATE_HOST.test(new URL(raw).hostname);
  } catch {
    return false;
  }
}

/**
 * Fetch the page while recording the redirect chain (manual redirects, max 4).
 * A redirect into a private host is refused, never followed.
 */
async function fetchPage(start: URL): Promise<FetchOk | FetchFailed> {
  const startedAt = Date.now();
  const steps: FetchStep[] = [];
  let current = start;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (isPrivate(current.toString())) {
      return {
        ok: false,
        reason: "the URL resolves to a private or local host",
        steps,
        totalMs: Date.now() - startedAt,
        blocked: true,
      };
    }

    const hopStarted = Date.now();
    let response: Response;
    try {
      const timeout =
        typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
          ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
          : undefined;
      response = await evidenceFetch()(current.toString(), {
        redirect: "manual",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "BuildLensEvidence/1.0 (+https://buildlens.app)",
        },
        signal: timeout ?? null,
      });
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "unknown network error",
        steps,
        totalMs: Date.now() - startedAt,
        blocked: false,
      };
    }

    const ms = Date.now() - hopStarted;
    const location = headerOf(response.headers, "location");
    steps.push({ url: current.toString(), status: response.status, location, ms });

    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return {
          ok: false,
          reason: "a redirect pointed at an unreadable URL",
          steps,
          totalMs: Date.now() - startedAt,
          blocked: false,
        };
      }
      if (isPrivate(next.toString())) {
        return {
          ok: false,
          reason: "a redirect pointed at a private or local host",
          steps,
          totalMs: Date.now() - startedAt,
          blocked: true,
        };
      }
      current = next;
      continue;
    }

    return {
      ok: true,
      response,
      finalUrl: current,
      steps,
      totalMs: Date.now() - startedAt,
    };
  }

  return {
    ok: false,
    reason: `more than ${MAX_REDIRECTS} redirects`,
    steps,
    totalMs: Date.now() - startedAt,
    blocked: false,
  };
}

interface Probe {
  url: string;
  status: number | null;
  ok: boolean;
  /** HEAD is not allowed → the resource exists but could not be measured. */
  unverifiable: boolean;
  ms: number;
  bytes: number | null;
  type: string | null;
}

async function probe(url: string): Promise<Probe> {
  const startedAt = Date.now();
  try {
    const timeout =
      typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
        ? AbortSignal.timeout(SUB_REQUEST_TIMEOUT_MS)
        : undefined;
    const response = await evidenceFetch()(url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "user-agent": "BuildLensEvidence/1.0 (+https://buildlens.app)" },
      signal: timeout ?? null,
    });
    const length = headerOf(response.headers, "content-length");
    return {
      url,
      status: response.status,
      ok: response.status < 400,
      unverifiable: response.status === 405 || response.status === 501,
      ms: Date.now() - startedAt,
      bytes: length && /^\d+$/.test(length) ? Number(length) : null,
      type: headerOf(response.headers, "content-type"),
    };
  } catch {
    return {
      url,
      status: null,
      ok: false,
      unverifiable: false,
      ms: Date.now() - startedAt,
      bytes: null,
      type: null,
    };
  }
}

/* --------------------------------------------------------------- extracting */

function absolute(raw: string, base: URL): string | null {
  const value = raw.trim();
  if (!value || value.startsWith("#") || /^(data|blob|mailto|tel|javascript):/i.test(value)) {
    return null;
  }
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function resourceUrls(html: string, base: URL): string[] {
  const raw = [
    ...[...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((match) => match[1] ?? ""),
    ...[...html.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)].map((match) => match[1] ?? ""),
    ...[...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((match) => match[1] ?? ""),
  ];
  return unique(
    raw.map((value) => absolute(value, base)).filter((value): value is string => Boolean(value)),
  );
}

function sameOrigin(urls: string[], base: URL): string[] {
  return urls.filter((value) => {
    try {
      return new URL(value).origin === base.origin;
    } catch {
      return false;
    }
  });
}

function linkUrls(html: string, base: URL): string[] {
  const raw = [...html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)].map((match) => match[1] ?? "");
  return unique(
    raw.map((value) => absolute(value, base)).filter((value): value is string => Boolean(value)),
  );
}

function observation(
  id: string,
  area: EvidenceObservation["area"],
  label: string,
  status: ObservationStatus,
  result: string,
  evidence: string[],
  confidence: EvidenceObservation["confidence"],
): EvidenceObservation {
  return { id, area, label, status, result, evidence, confidence };
}

/* --------------------------------------------------------------- inspection */

/** Read the submission's deployed site into an evidence outcome. */
export async function websiteEvidence(submission: EvaluationSubmission): Promise<IngestionOutcome> {
  const raw = submission.websiteUrl?.trim() ?? "";
  if (!raw) {
    return {
      kind: "website",
      status: "pending",
      text: null,
      detail: "No deployed website URL was provided with the submission.",
      facts: [],
      url: null,
      observations: [
        observation(
          "site.accessibility.reachable",
          "accessibility",
          "Deployed site reachable",
          "could_not_verify",
          "No deployed URL was submitted, so the live application could not be inspected.",
          ["No websiteUrl on the submission"],
          "high",
        ),
      ],
    };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return {
      kind: "website",
      status: "failed",
      text: null,
      detail: "The deployed website URL is not a valid URL, so the site could not be inspected.",
      facts: [],
      url: raw,
      observations: [
        observation(
          "site.accessibility.reachable",
          "accessibility",
          "Deployed site reachable",
          "could_not_verify",
          "The submitted URL is malformed, so nothing could be fetched.",
          [`Submitted value: ${clip(raw, 120)}`],
          "high",
        ),
      ],
    };
  }
  if (!/^https?:$/.test(url.protocol)) {
    return {
      kind: "website",
      status: "failed",
      text: null,
      detail: "The deployed website URL must start with http:// or https:// to be inspected.",
      facts: [],
      url: raw,
      observations: [
        observation(
          "site.accessibility.reachable",
          "accessibility",
          "Deployed site reachable",
          "could_not_verify",
          "The submitted URL is not an HTTP(S) address, so the site could not be inspected.",
          [`Submitted protocol: ${url.protocol}`],
          "high",
        ),
      ],
    };
  }
  if (PRIVATE_HOST.test(url.hostname)) {
    return {
      kind: "website",
      status: "failed",
      text: null,
      detail: "The deployed website points at a private or local host, which cannot be inspected.",
      facts: [],
      url: url.toString(),
      observations: [
        observation(
          "site.accessibility.reachable",
          "accessibility",
          "Deployed site reachable",
          "could_not_verify",
          "The URL points at a private or local host, which BuildLens does not fetch.",
          [`Host: ${url.hostname}`],
          "high",
        ),
      ],
    };
  }

  const fetched = await fetchPage(url);
  if (!fetched.ok) {
    return {
      kind: "website",
      status: "failed",
      text: null,
      detail: `${url.host} could not be inspected (${fetched.reason}). Website claims are unverified — this is not evidence that the site is missing.`,
      facts: [
        `Fetch failed after ${fetched.totalMs}ms: ${fetched.reason}.`,
        ...fetched.steps.map((step) => `${step.status} ${step.url}`),
      ],
      url: url.toString(),
      observations: [
        observation(
          "site.accessibility.reachable",
          "accessibility",
          "Deployed site reachable",
          "could_not_verify",
          fetched.blocked
            ? "The site points at a private or local host, so it was not inspected."
            : "The deployed site did not answer the public request, so nothing could be inspected.",
          [`${url.host}: ${fetched.reason}`, ...fetched.steps.map((s) => `${s.status} ${s.url}`)],
          "high",
        ),
        observation(
          "site.security.tls",
          "security",
          "HTTPS / TLS",
          "could_not_verify",
          "TLS could not be checked because the site did not respond.",
          [`Requested ${url.protocol}//${url.host}`],
          "medium",
        ),
      ],
    };
  }

  const { response, finalUrl, steps, totalMs } = fetched;
  const html = (await response.text().catch(() => "")).slice(0, MAX_HTML_CHARS);
  const observations: EvidenceObservation[] = [];
  const facts: string[] = [];

  /* ---------------------------------------------------------- accessibility */
  const https = finalUrl.protocol === "https:";
  const isUp = response.ok;
  const redirects = Math.max(0, steps.length - 1);
  const host = finalUrl.host;

  observations.push(
    // Explicit reachability record, so a judge sees the request that was made
    // rather than inferring availability from another row.
    observation(
      "site.accessibility.reachable",
      "accessibility",
      "Deployed site reachable",
      isUp ? "good" : response.status >= 500 ? "critical" : "warning",
      isUp
        ? `The deployed site answered the request and served a page at ${host}.`
        : `The deployed site answered with HTTP ${response.status}, so visitors do not get the landing page.`,
      [
        `Requested ${url.toString()}`,
        `Final URL: ${finalUrl.toString()}`,
        `HTTP ${response.status} in ${totalMs}ms`,
      ],
      "high",
    ),
    observation(
      "site.accessibility.https",
      "accessibility",
      "HTTPS / TLS",
      https ? "good" : "critical",
      https
        ? "The site is served over HTTPS."
        : "The site is served over plain HTTP, so traffic is not encrypted.",
      [`Final URL: ${finalUrl.toString()}`],
      "high",
    ),
    observation(
      "site.accessibility.status",
      "accessibility",
      "Landing page responds",
      isUp ? "good" : "critical",
      isUp
        ? `The landing page answered HTTP ${response.status} in ${totalMs}ms.`
        : `The landing page answered HTTP ${response.status}, so visitors do not get a working page.`,
      [`HTTP ${response.status} from ${host}`, `Total time ${totalMs}ms`],
      "high",
    ),
    observation(
      "site.accessibility.redirects",
      "accessibility",
      "Redirects",
      redirects === 0 ? "good" : redirects > 2 ? "warning" : "info",
      redirects === 0
        ? "The submitted URL is the final URL — no redirect chain."
        : `The page redirected ${redirects} time${redirects === 1 ? "" : "s"} before loading.`,
      steps.map(
        (step) => `${step.status} ${step.url}${step.location ? ` → ${step.location}` : ""}`,
      ),
      "high",
    ),
  );

  if (!response.ok || !html.trim()) {
    return {
      kind: "website",
      status: "failed",
      text: null,
      detail: `${host} responded with HTTP ${response.status}${html.trim() ? "" : " and an empty body"}, so page content could not be read.`,
      facts: [
        `HTTP ${response.status} from ${host} after ${totalMs}ms.`,
        ...observations.map((entry) => `${entry.label}: ${entry.status}`),
      ],
      url: finalUrl.toString(),
      observations,
    };
  }

  /* ------------------------------------------------------------ extracting */
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = firstMatch(
    html,
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i,
  );
  const generator = firstMatch(
    html,
    /<meta[^>]+name=["']generator["'][^>]*content=["']([^"']*)["']/i,
  );
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)]
    .map((match) => stripToText(match[1] ?? ""))
    .filter((value) => value.length > 0)
    .slice(0, 5);
  const scriptSources = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
    .map((match) => match[1] ?? "")
    .filter(Boolean);
  const forms = (html.match(/<form\b/gi) ?? []).length;
  const inputs = (html.match(/<(input|textarea|select)\b/gi) ?? []).length;
  const buttons = (html.match(/<button\b/gi) ?? []).length;
  const externalLinks = (html.match(/<a[^>]+href=["']https?:\/\//gi) ?? []).length;
  const frameworks = detectedFrameworks(html, scriptSources);
  const text = stripToText(html);
  const words = text ? text.split(/\s+/).length : 0;
  const viewport = firstMatch(
    html,
    /<meta[^>]+name=["']viewport["'][^>]*content=["']([^"']*)["']/i,
  );
  const lang = firstMatch(html, /<html[^>]+lang=["']([^"']+)["']/i);
  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  const imagesMissingAlt = images.filter((tag) => !/\balt\s*=/i.test(tag)).length;

  facts.push(
    `HTTP ${response.status} from ${host} in ${totalMs}ms (${https ? "HTTPS" : "HTTP"}).`,
    `HTML size ${Math.round(html.length / 1024)} KB · ${words} words of visible text.`,
    `Redirects: ${redirects}.`,
  );
  if (title) facts.push(`Page title: “${title}”.`);
  if (description) facts.push(`Meta description: “${description}”.`);
  if (generator) facts.push(`Generator meta tag: ${generator}.`);
  if (frameworks.length > 0)
    facts.push(`Framework signals in the markup: ${frameworks.join(", ")}.`);
  facts.push(
    `Interactive elements: ${forms} form${forms === 1 ? "" : "s"}, ${inputs} input${inputs === 1 ? "" : "s"}, ${buttons} button${buttons === 1 ? "" : "s"}.`,
    `${externalLinks} external link${externalLinks === 1 ? "" : "s"} found.`,
  );

  /* ---------------------------------------------------------------- probing */
  const assets = resourceUrls(html, finalUrl);
  const sameOriginAssets = sameOrigin(assets, finalUrl).slice(0, MAX_RESOURCE_CHECKS);
  const sameOriginLinks = sameOrigin(linkUrls(html, finalUrl), finalUrl)
    .filter((value) => value.split("#")[0] !== finalUrl.toString())
    .slice(0, MAX_LINK_CHECKS);

  const [assetProbes, linkProbes] = await Promise.all([
    Promise.all(sameOriginAssets.map(probe)),
    Promise.all(sameOriginLinks.map(probe)),
  ]);

  /* -------------------------------------------------------------- security */
  const headerValues = allHeaders(response.headers);
  const presentHeaders = SECURITY_HEADERS.filter((header) => headerValues.has(header.key));
  const missingHeaders = SECURITY_HEADERS.filter((header) => !headerValues.has(header.key));

  observations.push(
    observation(
      "site.security.headers",
      "security",
      "Security headers",
      missingHeaders.length === 0 ? "good" : presentHeaders.length === 0 ? "warning" : "warning",
      missingHeaders.length === 0
        ? "All of the commonly checked security headers were present on this response."
        : `${presentHeaders.length} of ${SECURITY_HEADERS.length} commonly checked security headers were present; ${missingHeaders.length} were not sent.`,
      [
        ...presentHeaders.map(
          (header) => `${header.key}: ${clip(headerValues.get(header.key) ?? "", 100)}`,
        ),
        ...missingHeaders.map((header) => `${header.key}: not sent`),
      ],
      "high",
    ),
  );

  const mixedContent = assets.filter((value) => value.startsWith("http://"));
  observations.push(
    observation(
      "site.security.mixed_content",
      "security",
      "Mixed content",
      mixedContent.length === 0 ? "not_detected" : "warning",
      mixedContent.length === 0
        ? https
          ? "No resources loaded over plain HTTP were found in the page markup."
          : "The page itself is served over HTTP, so mixed-content checks do not apply."
        : `${mixedContent.length} resource${mixedContent.length === 1 ? "" : "s"} load over plain HTTP on an HTTPS page.`,
      mixedContent.slice(0, 5),
      "medium",
    ),
  );

  const inlineAndHtml = html.replace(/<script[^>]*src=["'][^"']+["'][^>]*><\/script>/gi, "");
  const secretHits = SECRET_PATTERNS.filter((entry) => entry.pattern.test(inlineAndHtml)).map(
    (entry) => entry.label,
  );
  observations.push(
    observation(
      "site.security.secrets",
      "security",
      "Secrets in public assets",
      secretHits.length === 0 ? "not_detected" : "critical",
      secretHits.length === 0
        ? "No obvious exposed secrets were detected in the served HTML and inline scripts. Server-side secrets and API responses were not inspected."
        : `Pattern${secretHits.length === 1 ? "" : "s"} matching a secret key ${secretHits.length === 1 ? "was" : "were"} found in the served HTML: ${secretHits.join(", ")}. The values are withheld.`,
      secretHits.map((label) => `Pattern matched: ${label} (value withheld)`),
      secretHits.length === 0 ? "medium" : "high",
    ),
    observation(
      "site.security.server_side",
      "security",
      "Server-side vulnerabilities",
      "could_not_verify",
      "Server-side security (authorization, injection, data exposure) cannot be verified from a public page load. This is not a pass.",
      ["No authenticated or server-side testing was performed"],
      "high",
    ),
  );

  /* ----------------------------------------------------------- performance */
  const responseStatus: ObservationStatus =
    totalMs <= SLOW_RESPONSE_MS / 2 ? "good" : totalMs <= SLOW_RESPONSE_MS ? "warning" : "warning";
  observations.push(
    observation(
      "site.performance.response",
      "performance",
      "Initial response time",
      responseStatus,
      `The server answered the page request in ${totalMs}ms (measured once from BuildLens).`,
      [`HTTP ${response.status} in ${totalMs}ms`, `Threshold flag: >${SLOW_RESPONSE_MS}ms is slow`],
      "medium",
    ),
    observation(
      "site.performance.html_size",
      "performance",
      "HTML size",
      html.length > LARGE_HTML_BYTES ? "warning" : "good",
      `The initial HTML document is ${Math.round(html.length / 1024)} KB.`,
      [`${html.length} bytes of HTML`],
      "high",
    ),
  );

  const failedAssets = assetProbes.filter((entry) => !entry.ok && !entry.unverifiable);
  const largeAssets = assetProbes.filter(
    (entry) => entry.bytes !== null && entry.bytes > LARGE_ASSET_BYTES,
  );
  const slowAssets = assetProbes.filter((entry) => entry.ms > SLOW_ASSET_MS);
  const measuredAssets = assetProbes.filter((entry) => entry.status !== null);

  const failedResourceLines = failedAssets.map(
    (entry) => `${entry.url} — ${entry.status === null ? "no response" : `HTTP ${entry.status}`}`,
  );
  const largeResourceLines = largeAssets.map(
    (entry) =>
      `${entry.url} — ${entry.bytes === null ? "size unknown" : `${Math.round(entry.bytes / 1024)} KB`}`,
  );

  observations.push(
    observation(
      "site.performance.failed_resources",
      "performance",
      "Failed resources",
      assetProbes.length === 0 ? "could_not_verify" : failedAssets.length > 0 ? "warning" : "good",
      assetProbes.length === 0
        ? "No same-origin resources were found to request, so resource failures could not be measured."
        : failedAssets.length === 0
          ? `All ${assetProbes.length} sampled resource${assetProbes.length === 1 ? "" : "s"} responded normally.`
          : `${failedAssets.length} of ${assetProbes.length} sampled resources did not respond successfully.`,
      failedResourceLines.slice(0, MAX_RESOURCE_CHECKS),
      "medium",
    ),
    observation(
      "site.performance.large_assets",
      "performance",
      "Large assets",
      measuredAssets.length === 0
        ? "could_not_verify"
        : largeAssets.length > 0
          ? "warning"
          : "good",
      measuredAssets.length === 0
        ? "Resource sizes could not be measured (no content-length was returned)."
        : largeAssets.length === 0
          ? `No sampled resource was larger than ${Math.round(LARGE_ASSET_BYTES / 1000)} KB.`
          : `${largeAssets.length} sampled resource${largeAssets.length === 1 ? " is" : "s are"} larger than ${Math.round(LARGE_ASSET_BYTES / 1000)} KB.`,
      largeResourceLines.slice(0, MAX_RESOURCE_CHECKS),
      "medium",
    ),
    observation(
      "site.performance.assets",
      "performance",
      "Assets sampled",
      measuredAssets.length === 0
        ? "could_not_verify"
        : failedAssets.length > 0
          ? "warning"
          : "good",
      measuredAssets.length === 0
        ? "No same-origin script, stylesheet or image URLs were found to measure."
        : `${measuredAssets.length} same-origin asset${measuredAssets.length === 1 ? "" : "s"} sampled; ${failedAssets.length} failed, ${largeAssets.length} over ${Math.round(LARGE_ASSET_BYTES / 1000)} KB, ${slowAssets.length} slower than ${SLOW_ASSET_MS}ms.`,
      assetProbes
        .slice(0, MAX_RESOURCE_CHECKS)
        .map(
          (entry) =>
            `${entry.url} — ${entry.status ?? "no response"}${entry.bytes !== null ? `, ${Math.round(entry.bytes / 1024)} KB` : ""}, ${entry.ms}ms`,
        ),
      "medium",
    ),
    observation(
      "site.performance.lighthouse",
      "performance",
      "Lighthouse / PageSpeed metrics",
      "could_not_verify",
      "No Lighthouse or PageSpeed run is performed, so no performance score is reported. The measurements above are the raw observations.",
      ["Not implemented: no headless browser audit in this environment"],
      "high",
    ),
  );

  /* ------------------------------------------------------------- functionality */
  const brokenLinks = linkProbes.filter((entry) => !entry.ok && !entry.unverifiable);
  const jsShell = words < 40 && scriptSources.length > 0;

  observations.push(
    observation(
      "site.functionality.content",
      "functionality",
      "Landing page content",
      jsShell ? "warning" : words > 0 ? "good" : "warning",
      jsShell
        ? `The server-rendered HTML carries only ${words} words; the interface is assembled by JavaScript, so a no-JS visitor sees little.`
        : `${words} words of visible text were delivered in the HTML.`,
      [
        `HTML ${Math.round(html.length / 1024)} KB`,
        `${scriptSources.length} external script${scriptSources.length === 1 ? "" : "s"}`,
      ],
      "medium",
    ),
    observation(
      "site.functionality.links",
      "functionality",
      "Links on the landing page",
      linkProbes.length === 0 ? "could_not_verify" : brokenLinks.length > 0 ? "warning" : "good",
      linkProbes.length === 0
        ? "No same-origin links were available to check."
        : brokenLinks.length === 0
          ? `${linkProbes.length} same-origin link${linkProbes.length === 1 ? "" : "s"} responded normally.`
          : `${brokenLinks.length} of ${linkProbes.length} checked links did not respond successfully.`,
      linkProbes.map((entry) => `${entry.url} — ${entry.status ?? "no response"}`),
      "low",
    ),
    observation(
      "site.functionality.interactions",
      "functionality",
      "Interactive UI",
      inputs + buttons + forms > 0 ? "info" : "warning",
      inputs + buttons + forms > 0
        ? `The page exposes ${forms} form${forms === 1 ? "" : "s"}, ${inputs} input${inputs === 1 ? "" : "s"} and ${buttons} button${buttons === 1 ? "" : "s"} in its markup.`
        : "No forms, inputs or buttons appear in the page markup.",
      [`forms: ${forms}`, `inputs: ${inputs}`, `buttons: ${buttons}`],
      "medium",
    ),
    observation(
      "site.functionality.flows",
      "functionality",
      "Claimed features exercised",
      "could_not_verify",
      "Individual features were not clicked through or exercised; only the landing page and its public links were inspected.",
      ["No authenticated or scripted browser session was used"],
      "high",
    ),
  );

  /* ------------------------------------------------------------ auth flow */
  // What the served markup literally shows — a login / sign-up entry point is
  // observable, the flow behind it is not exercised.
  const authSignals = unique(
    [
      ...html.matchAll(
        /\b(log ?in|log ?on|sign ?in|sign ?up|register|create account|forgot password|continue with google|continue with github)\b/gi,
      ),
    ].map((match) => match[0].toLowerCase()),
  );
  observations.push(
    authSignals.length > 0
      ? observation(
          "site.functionality.auth",
          "functionality",
          "Login / sign-up entry point",
          "good",
          `The landing page exposes a login or sign-up entry point (${authSignals
            .slice(0, 3)
            .map((signal) => `“${signal}”`)
            .join(", ")}). The form behind it was not submitted or exercised.`,
          [...authSignals.slice(0, 4), `Final URL: ${finalUrl.toString()}`],
          "high",
        )
      : observation(
          "site.functionality.auth",
          "functionality",
          "Login / sign-up entry point",
          "not_detected",
          "No login or sign-up entry point was visible in the served landing-page markup. It may exist behind a route the inspection did not reach.",
          [`Searched markup of ${finalUrl.toString()}`],
          "medium",
        ),
  );

  /* ------------------------------------------------------------------- UX */
  observations.push(
    observation(
      "site.ux.viewport",
      "ux",
      "Mobile viewport",
      viewport ? "good" : "warning",
      viewport
        ? "A responsive viewport meta tag is present, so the page opts into mobile layout."
        : "No viewport meta tag was found, so mobile browsers will render the desktop layout.",
      [viewport ? `viewport: ${viewport}` : "meta viewport: not found"],
      "high",
    ),
    observation(
      "site.ux.metadata",
      "ux",
      "Page metadata",
      title && (h1s.length > 0 || description) ? "good" : "warning",
      title
        ? `Title “${title}”${h1s.length > 0 ? ` · ${h1s.length} H1 heading${h1s.length === 1 ? "" : "s"}` : " · no H1 heading"}${description ? " · meta description present" : " · no meta description"}.`
        : "The page has no title, which hurts clarity and link previews.",
      [title ? `title: ${title}` : "title: missing", lang ? `lang: ${lang}` : "lang: not set"],
      "high",
    ),
    observation(
      "site.ux.images",
      "ux",
      "Image accessibility",
      images.length === 0 ? "could_not_verify" : imagesMissingAlt > 0 ? "warning" : "good",
      images.length === 0
        ? "No images are declared in the HTML (they may be loaded by scripts)."
        : imagesMissingAlt === 0
          ? `All ${images.length} image${images.length === 1 ? "" : "s"} in the markup carry an alt attribute.`
          : `${imagesMissingAlt} of ${images.length} images in the markup have no alt text.`,
      imagesMissingAlt > 0
        ? [
            `${imagesMissingAlt} img tag(s) without alt`,
            ...images.slice(0, 3).map((tag) => clip(tag, 120)),
          ]
        : [],
      "medium",
    ),
    observation(
      "site.ux.layout",
      "ux",
      "Layout overflow / responsiveness",
      "could_not_verify",
      "Layout overflow, broken mobile layouts and unreadable text require a rendered browser; they were not visually inspected.",
      ["No headless browser rendering in this environment"],
      "high",
    ),
  );

  const textBlock = [
    `Deployed site: ${finalUrl.toString()}`,
    title ? `Title: ${title}` : null,
    description ? `Description: ${description}` : null,
    generator ? `Generator: ${generator}` : null,
    frameworks.length > 0 ? `Framework signals: ${frameworks.join(", ")}` : null,
    `Visible text (${words} words):\n${clip(text, MAX_TEXT_CHARS)}`,
    // The inspection findings deliberately stay OUT of `text`: that field is what
    // claim comparison reads, and matching a claim against “could not verify …”
    // would let the report verify itself. `observations` carries them instead.
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  // Runtime evidence: what a public visitor can actually see at the deployed
  // URL. Claim comparison cites this as `Deployed page: <url>`.
  const runtimeSegments: EvidenceSegment[] = [
    {
      ref: `Deployed page: ${finalUrl.toString()}`,
      kind: "runtime",
      text: textBlock,
    },
    {
      ref: `Deployed page: ${host} markup (login entry points)`,
      kind: "runtime",
      text: authSignals.join(" "),
    },
  ];
  const segments = runtimeSegments.filter((segment) => segment.text.trim().length > 0);

  return {
    kind: "website",
    status: "ingested",
    text: textBlock,
    detail: `${host} was fetched (HTTP ${response.status}, ${words} words of visible text) and inspected for accessibility, functionality, performance, security and UX signals.`,
    facts,
    url: finalUrl.toString(),
    observations,
    segments,
  };
}
