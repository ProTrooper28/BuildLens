import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ChevronDown } from "lucide-react";

import { EASE_OUT } from "@/components/motion/primitives";
import { StatusMark } from "@/components/evaluation/inspection-ui";
import type { EvidenceBundle } from "@/services/evidence/types";
import type { InspectionCheck } from "@/services/inspection/types";
import type { FeatureVerification } from "@/services/verification/types";
import { cn } from "@/lib/utils";

/**
 * Shared presentation pieces for the judging screens.
 *
 * One surface, one rhythm, one status language: a page of evidence should read
 * like a report, not a dashboard. Everything here is deliberately quiet —
 * hairline borders, no shadows stacked on shadows, no tinted panels competing
 * with the content.
 */

/* --------------------------------------------------------------- surfaces */

export function Surface({
  id,
  className,
  children,
}: {
  id?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-28 overflow-hidden rounded-xl border border-border bg-card",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SurfaceHeader({
  eyebrow,
  title,
  description,
  aside,
  className,
}: {
  eyebrow?: string | undefined;
  title: string;
  description?: string | undefined;
  aside?: ReactNode | undefined;
  className?: string | undefined;
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-5 py-4",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h2 className={cn("text-[15px] font-semibold tracking-tight", eyebrow && "mt-1")}>
          {title}
        </h2>
        {description && (
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {aside && <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div>}
    </header>
  );
}

export function SurfaceBody({
  className,
  children,
}: {
  className?: string | undefined;
  children: ReactNode;
}) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <p
      className={cn(
        "text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ blocks */

export function MetricGrid({
  items,
}: {
  items: { label: string; value: string; hint?: string | undefined }[];
}) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {item.label}
          </dt>
          <dd className="mt-1 truncate text-[13px] font-medium text-foreground" title={item.value}>
            {item.value}
          </dd>
          {item.hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{item.hint}</p>}
        </div>
      ))}
    </dl>
  );
}

const LIST_TONE = {
  neutral: "bg-muted-foreground/40",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
} as const;

export function ListBlock({
  title,
  items,
  empty,
  limit = 3,
  tone = "neutral",
  className,
  moreLabel = "more in the detailed analysis",
}: {
  title: string;
  items: string[];
  empty: string;
  limit?: number;
  tone?: keyof typeof LIST_TONE;
  className?: string | undefined;
  moreLabel?: string;
}) {
  const shown = items.slice(0, limit);
  return (
    <div className={cn("min-w-0", className)}>
      <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </h3>
      {shown.length === 0 ? (
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {shown.map((item, index) => (
            <li
              key={`${item}-${index}`}
              className="flex gap-2 text-[13px] leading-relaxed text-foreground/90"
            >
              <span
                className={cn("mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full", LIST_TONE[tone])}
                aria-hidden
              />
              <span className="min-w-0">{item}</span>
            </li>
          ))}
          {items.length > shown.length && (
            <li className="pl-3.5 text-[11px] text-muted-foreground">
              +{items.length - shown.length} {moreLabel}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** "8 supported · 2 partial · 1 not found" — one quiet line, no pill soup. */
export function CountLine({
  counts,
  className,
}: {
  counts: {
    supported: number;
    partially_supported: number;
    not_found: number;
    could_not_verify: number;
  };
  className?: string | undefined;
}) {
  const parts = [
    { count: counts.supported, label: "supported", dot: "bg-success" },
    { count: counts.partially_supported, label: "partial", dot: "bg-warning" },
    { count: counts.not_found, label: "not found", dot: "bg-destructive" },
    { count: counts.could_not_verify, label: "could not verify", dot: "bg-muted-foreground/45" },
  ];
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {parts.map((part) => (
        <span key={part.label} className="inline-flex items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 rounded-full", part.dot)} aria-hidden />
          <span className="tabular-nums font-medium text-foreground/80">{part.count}</span>
          {part.label}
        </span>
      ))}
    </p>
  );
}

/* ------------------------------------------------------------- disclosure */

export function Disclosure({
  id,
  title,
  meta,
  status,
  defaultOpen = false,
  children,
}: {
  id?: string | undefined;
  title: string;
  meta?: string | undefined;
  status?: InspectionCheck["status"] | undefined;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div id={id} className="scroll-mt-28 border-b border-border/60 last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start gap-2.5 px-5 py-3.5 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        <ChevronDown
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium leading-snug text-foreground">
            {title}
          </span>
          {meta && (
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              {meta}
            </span>
          )}
        </span>
        {status && <StatusMark status={status} className="mt-0.5" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <div className="pb-4 pl-12 pr-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Exact file paths, URLs, headers or quotes behind a finding. */
export function EvidenceList({ items, limit = 8 }: { items: string[]; limit?: number }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, limit);
  return (
    <ul className="mt-2 space-y-1 border-l-2 border-border pl-3">
      {shown.map((item, index) => (
        <li
          key={`${item}-${index}`}
          className="break-words font-mono text-[11px] leading-relaxed text-foreground/70"
        >
          {item}
        </li>
      ))}
      {items.length > shown.length && (
        <li className="text-[11px] text-muted-foreground">
          +{items.length - shown.length} more item{items.length - shown.length === 1 ? "" : "s"}
        </li>
      )}
    </ul>
  );
}

export function FindingRow({ check }: { check: InspectionCheck }) {
  const confidence = [
    `Confidence: ${check.confidence}`,
    check.pageRefs && check.pageRefs.length > 0 ? `deck page ${check.pageRefs.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Disclosure title={check.title} meta={check.result} status={check.status}>
      <p className="text-[13px] leading-relaxed text-muted-foreground">{check.explanation}</p>
      <EvidenceList items={check.evidence} />
      <p className="mt-2 text-[11px] text-muted-foreground">{confidence}</p>
    </Disclosure>
  );
}

export function CheckList({ checks, empty }: { checks: InspectionCheck[]; empty: string }) {
  if (checks.length === 0) {
    return <p className="px-5 py-4 text-[13px] text-muted-foreground">{empty}</p>;
  }
  return (
    <div>
      {checks.map((check) => (
        <FindingRow key={check.id} check={check} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ claims */

function checkedAgainst(check: InspectionCheck): string[] {
  const line = check.evidence.find((item) => item.startsWith("Checked against: "));
  if (!line) return [];
  return line.replace("Checked against: ", "").split(/,\s*/).filter(Boolean);
}

/** One claim: what the team said, what was found, and where to look. */
export function ClaimRow({
  check,
  submissionId,
}: {
  check: InspectionCheck;
  submissionId?: string | undefined;
}) {
  const sources = checkedAgainst(check);
  const pageRefs = check.pageRefs ?? [];
  // When the per-source cross-check is present it already names every source,
  // so the meta line only adds the deck location.
  const hasCrossCheck = (check.crossChecks?.length ?? 0) > 0;
  const meta = [
    ...(hasCrossCheck ? [] : sources),
    ...(pageRefs.length > 0 ? [`Deck p.${pageRefs.join(", ")}`] : []),
  ];

  return (
    <div
      id={`claim-${check.id}`}
      className="scroll-mt-28 border-b border-border/60 last:border-b-0"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium leading-snug">{check.title}</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            {check.explanation}
          </p>
          {meta.length > 0 && (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              {meta.map((item, index) => (
                <span key={`${item}-${index}`} className="inline-flex items-center gap-2">
                  {index > 0 && <span aria-hidden>·</span>}
                  {item}
                </span>
              ))}
            </p>
          )}
          {check.crossChecks && check.crossChecks.length > 0 && (
            <ul className="mt-2.5 space-y-1">
              {check.crossChecks.map((cross) => (
                <li key={cross.source} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="w-24 shrink-0 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    {cross.source}
                  </span>
                  <StatusMark status={cross.status} />
                  <span className="min-w-0 text-[11px] text-muted-foreground">{cross.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <StatusMark status={check.status} />
      </div>
      <Disclosure
        title="Evidence"
        meta={`${check.evidence.length} item${check.evidence.length === 1 ? "" : "s"}`}
      >
        <EvidenceList items={check.evidence} limit={12} />
        {submissionId && (
          <Link
            to="/evaluation/project/$id/analysis"
            params={{ id: submissionId }}
            hash={`claim-${check.id}`}
            className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-medium text-primary transition-opacity hover:opacity-80"
          >
            Open in detailed analysis
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </Disclosure>
    </div>
  );
}

/* ------------------------------------------------------------ claim table */

/** Claim status → the wording a judge uses. Never hedges, never inflates. */
const CLAIM_VERDICT_TEXT: Partial<Record<InspectionCheck["status"], string>> = {
  supported: "Supported",
  good: "Supported",
  partially_supported: "Partially supported",
  warning: "Partially supported",
  not_found: "Not supported",
  critical: "Not supported",
  could_not_verify: "Could not verify",
  not_detected: "Could not verify",
  info: "Could not verify",
};

function claimVerdictLabel(check: InspectionCheck): string {
  return CLAIM_VERDICT_TEXT[check.status] ?? "Could not verify";
}

/** Where a claim came from, without a file path in the first screen. */
function claimSource(check: InspectionCheck): string {
  if ((check.pageRefs?.length ?? 0) > 0) return "Deck";
  if (check.id.includes("readme")) return "README";
  if (check.id.includes("description") || check.id.includes("detail")) return "Submission";
  return "Submission";
}

const IMPACT_TONE = {
  critical: "text-destructive",
  high: "text-destructive",
  medium: "text-warning",
  low: "text-muted-foreground",
} as const;

/**
 * How much an unsupported claim should change a decision. It follows the claim's
 * kind, not its wording: a missing AI or security claim is not the same as a
 * missing nice-to-have.
 */
function claimImpact(
  check: InspectionCheck,
): { label: string; tone: keyof typeof IMPACT_TONE } | null {
  if (check.status === "supported" || check.status === "good") return null;
  if (check.status === "not_found" || check.status === "critical") {
    const core =
      check.claimKind === "ai" ||
      check.claimKind === "security" ||
      check.claimKind === "functionality";
    return { label: core ? "Critical" : "High", tone: core ? "critical" : "high" };
  }
  if (check.status === "partially_supported" || check.status === "warning") {
    return { label: "Medium", tone: "medium" };
  }
  return { label: "Unknown", tone: "low" };
}

const TABLE_GRID =
  "sm:grid-cols-[minmax(0,1.5fr)_72px_minmax(0,1.7fr)_112px_76px] sm:items-baseline sm:gap-3";

export function ClaimTable({
  checks,
  limit,
  empty,
}: {
  checks: InspectionCheck[];
  limit?: number | undefined;
  empty: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = limit ? checks.slice(0, limit) : checks;

  if (rows.length === 0) {
    return <p className="px-5 py-4 text-[13px] text-muted-foreground">{empty}</p>;
  }

  return (
    <div>
      <div
        className={cn(
          "hidden gap-3 border-y border-border/70 bg-muted/25 px-5 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground sm:grid",
          TABLE_GRID,
        )}
        aria-hidden
      >
        <span>Claim</span>
        <span>Source</span>
        <span>Evidence</span>
        <span>Verdict</span>
        <span className="text-right">Impact</span>
      </div>
      <ul className="divide-y divide-border/60">
        {rows.map((check) => {
          const impact = claimImpact(check);
          const expanded = open === check.id;
          return (
            <li key={check.id} id={`claim-table-${check.id}`} className="scroll-mt-28">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : check.id)}
                className={cn(
                  "grid w-full grid-cols-1 gap-1 px-5 py-3 text-left transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
                  TABLE_GRID,
                )}
              >
                <span className="text-[13px] font-medium leading-snug">{check.title}</span>
                <span className="text-[11px] text-muted-foreground">{claimSource(check)}</span>
                <span className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                  {check.explanation}
                </span>
                <StatusMark status={check.status} label={claimVerdictLabel(check)} />
                <span
                  className={cn(
                    "text-[10px] font-semibold uppercase tracking-[0.1em] sm:text-right",
                    impact ? IMPACT_TONE[impact.tone] : "text-muted-foreground/60",
                  )}
                >
                  {impact?.label ?? "—"}
                </span>
              </button>
              {expanded && (
                <div className="border-t border-border/60 bg-muted/15 px-5 py-3">
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {check.explanation}
                  </p>
                  <div className="mt-2">
                    <EvidenceList items={check.evidence} limit={10} />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------- feature table */

export function FeatureTable({
  features,
  limit,
  empty,
}: {
  features: FeatureVerification[];
  limit?: number | undefined;
  empty: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = limit ? features.slice(0, limit) : features;

  if (rows.length === 0) {
    return <p className="px-5 py-4 text-[13px] text-muted-foreground">{empty}</p>;
  }

  return (
    <div>
      <div
        className="hidden grid-cols-[minmax(0,1.7fr)_70px_60px_60px_150px] gap-3 border-y border-border/70 bg-muted/25 px-5 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground sm:grid"
        aria-hidden
      >
        <span>Feature</span>
        <span>Claimed</span>
        <span>Found</span>
        <span>Tested</span>
        <span>Result</span>
      </div>
      <ul className="divide-y divide-border/60">
        {rows.map((feature) => {
          const expanded = open === feature.id;
          const status: InspectionCheck["status"] =
            feature.result === "supported"
              ? "supported"
              : feature.result === "partial"
                ? "partially_supported"
                : feature.result === "not_supported"
                  ? "not_found"
                  : "could_not_verify";
          return (
            <li key={feature.id} id={`feature-${feature.id}`} className="scroll-mt-28">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : feature.id)}
                className="grid w-full grid-cols-1 gap-1 px-5 py-3 text-left transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 sm:grid-cols-[minmax(0,1.7fr)_70px_60px_60px_150px] sm:items-baseline sm:gap-3"
              >
                <span className="text-[13px] font-medium leading-snug">{feature.feature}</span>
                <Cell label="Claimed" value="Yes" />
                <Cell
                  label="Found"
                  value={feature.found ? "Yes" : "No"}
                  tone={feature.found ? "text-foreground/80" : "text-muted-foreground"}
                />
                <Cell
                  label="Tested"
                  value={feature.tested ? "Yes" : "No"}
                  tone={feature.tested ? "text-foreground/80" : "text-muted-foreground"}
                />
                <StatusMark
                  status={status}
                  label={
                    feature.result === "supported"
                      ? "Supported"
                      : feature.result === "partial"
                        ? "Partial"
                        : feature.result === "not_supported"
                          ? "Not supported"
                          : "Could not verify"
                  }
                />
              </button>
              {expanded && (
                <div className="border-t border-border/60 bg-muted/15 px-5 py-3">
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {feature.note}
                  </p>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Searched: {feature.searched.join(" · ") || "nothing readable"}
                  </p>
                  {feature.evidence.length > 0 && (
                    <div className="mt-2">
                      <EvidenceList items={feature.evidence} limit={8} />
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A small labelled cell, so the table still reads on a narrow screen. */
function Cell({
  label,
  value,
  tone = "text-foreground/80",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <span className={cn("text-[11px]", tone)}>
      <span className="text-muted-foreground sm:hidden">{label}: </span>
      {value}
    </span>
  );
}

/* -------------------------------------------------------------------- nav */

export function SectionNav({ items }: { items: { id: string; label: string }[] }) {
  const key = items.map((item) => item.id).join(",");
  const [active, setActive] = useState(items[0]?.id ?? "");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const ids = key.split(",").filter(Boolean);
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-112px 0px -62% 0px", threshold: 0 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [key]);

  return (
    <nav
      aria-label="Analysis sections"
      className="sticky top-16 z-30 -mx-4 mb-6 border-b border-border bg-background/95 px-4 backdrop-blur-sm sm:-mx-6 sm:px-6"
    >
      <ul className="flex gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={active === item.id ? "true" : undefined}
              className={cn(
                "inline-flex whitespace-nowrap border-b-2 px-2.5 py-2.5 text-xs transition-colors",
                active === item.id
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* --------------------------------------------------------------- progress */

type ProgressState = "waiting" | "active" | "done" | "warn" | "muted";

function ProgressRow({
  label,
  state,
  note,
}: {
  label: string;
  state: ProgressState;
  note: string;
}) {
  return (
    <li className="flex items-start justify-between gap-3 py-1.5">
      <span className="inline-flex min-w-0 items-center gap-2 text-[13px] text-foreground/90">
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            state === "done" && "bg-success",
            state === "warn" && "bg-warning",
            state === "active" && "animate-pulse bg-primary",
            (state === "waiting" || state === "muted") && "bg-muted-foreground/40",
          )}
          aria-hidden
        />
        {label}
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{note}</span>
    </li>
  );
}

/**
 * Stage-by-stage progress for an evidence run.
 *
 * The three sources are read in parallel and the bundle is persisted only once
 * all of them finish, so before that point every source honestly reads
 * "reading". Once the bundle exists, each source shows what actually happened
 * and the only stage left is the model summary.
 */
export function EvidenceProgress({
  bundle,
  className,
}: {
  bundle: EvidenceBundle | null;
  className?: string | undefined;
}) {
  const stateOf = (
    kind: "document" | "repository" | "website",
  ): { state: ProgressState; note: string } => {
    if (!bundle) return { state: "active", note: "Reading…" };
    const source = bundle.sources.find((entry) => entry.kind === kind);
    if (!source) return { state: "muted", note: "Not provided" };
    if (source.readable) return { state: "done", note: "Read" };
    return {
      state: "warn",
      note: source.status === "failed" ? "Could not be read" : "Not submitted",
    };
  };

  const deck = stateOf("document");
  const repository = stateOf("repository");
  const deployment = stateOf("website");

  return (
    <div className={className} aria-live="polite">
      <ul className="divide-y divide-border/50">
        <ProgressRow label="Reading the submitted deck" state={deck.state} note={deck.note} />
        <ProgressRow
          label="Reading the repository"
          state={repository.state}
          note={repository.note}
        />
        <ProgressRow
          label="Inspecting the deployment"
          state={deployment.state}
          note={deployment.note}
        />
        <ProgressRow
          label="Comparing claims with evidence"
          state={bundle ? "done" : "waiting"}
          note={bundle ? `${bundle.claims.length} compared` : "Queued"}
        />
        <ProgressRow
          label="Generating the summary"
          state={bundle ? "active" : "waiting"}
          note={bundle ? "Generating…" : "Queued"}
        />
      </ul>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        The deck, repository and deployment are read in parallel. Safe to refresh — the run keeps
        going and this page reattaches to it. Your scores are never changed by an inspection.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ empty */

export function EmptyState({
  title,
  description,
  action,
  tone = "neutral",
}: {
  title: string;
  description: string;
  action?: ReactNode | undefined;
  tone?: "neutral" | "danger";
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className="rounded-xl border border-dashed border-border px-6 py-12 text-center"
    >
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
      {action && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div>
      )}
    </div>
  );
}
