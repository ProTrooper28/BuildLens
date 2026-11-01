import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { SEVERITY_LABELS, type Finding, type FindingSeverity } from "@/services/inspection/types";

/**
 * JUDGE ATTENTION.
 *
 * Answers one question: what actually requires the judge's attention?
 *
 * Every line is a grouped, severity-ranked finding ("2 claims could not be
 * verified") with up to three examples — never one warning per sentence of the
 * deck. Low and informational findings are deliberately absent: they live in the
 * detailed analysis, so a missing README cannot outrank a committed secret.
 */

const SEVERITY_STYLE: Record<FindingSeverity, { dot: string; text: string; label: string }> = {
  critical: { dot: "bg-destructive", text: "text-destructive", label: "Critical" },
  high: { dot: "bg-warning", text: "text-warning", label: "High" },
  medium: { dot: "bg-primary", text: "text-primary", label: "Medium" },
  low: { dot: "bg-muted-foreground/60", text: "text-muted-foreground", label: "Low" },
  info: { dot: "bg-muted-foreground/40", text: "text-muted-foreground", label: "Info" },
};

export function JudgeAttention({
  findings,
  id = "judge-attention",
  onNavigate,
}: {
  /** Only the findings a judge must act on (critical / high / medium). */
  findings: Finding[];
  id?: string;
  /** Section link handler; renders a `#section-…` anchor when absent. */
  onNavigate?: (section: Finding["link"]["section"]) => void;
}) {
  const count = findings.length;

  return (
    <section id={id} className="scroll-mt-24">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Judge attention</h2>
        <p className="text-[11px] text-muted-foreground">
          {count === 0
            ? "Nothing needs review"
            : `${count} issue${count === 1 ? "" : "s"} require${count === 1 ? "s" : ""} review`}
        </p>
      </div>

      {count === 0 ? (
        <p className="mt-2 rounded-lg border border-success/25 bg-success/[0.06] px-3 py-2.5 text-xs text-foreground/85">
          No critical, high or medium finding came out of the sources that were read. Unverified
          claims are still listed in claim verification — they are gaps, not problems.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {findings.map((finding) => {
            const style = SEVERITY_STYLE[finding.severity];
            return (
              <li
                key={finding.id}
                className="rounded-lg border border-border/70 bg-card/40 px-3 py-2.5"
              >
                <div className="flex items-start gap-2">
                  <span
                    className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", style.dot)}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span
                        className={cn(
                          "text-[10px] font-semibold uppercase tracking-wide",
                          style.text,
                        )}
                      >
                        {SEVERITY_LABELS[finding.severity]}
                      </span>
                      <span className="text-xs font-medium text-foreground/90">{finding.title}</span>
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      {finding.summary}
                    </p>
                    {finding.items.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {finding.items.slice(0, 3).map((item, index) => (
                          <li
                            key={`${finding.id}-${index}`}
                            className="truncate text-[11px] text-foreground/75"
                          >
                            · {item}
                          </li>
                        ))}
                        {finding.count > 3 && (
                          <li className="text-[11px] text-muted-foreground">
                            +{finding.count - 3} more in {finding.areaLabel.toLowerCase()}
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                  {onNavigate ? (
                    <button
                      type="button"
                      onClick={() => onNavigate(finding.link.section)}
                      className="shrink-0 whitespace-nowrap text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
                    >
                      {finding.link.label}
                      <ArrowRight className="ml-0.5 inline h-3 w-3" aria-hidden />
                    </button>
                  ) : (
                    <a
                      href={`#section-${finding.link.section}`}
                      className="shrink-0 whitespace-nowrap text-[11px] font-medium text-primary transition-colors hover:text-primary/80"
                    >
                      {finding.link.label}
                      <ArrowRight className="ml-0.5 inline h-3 w-3" aria-hidden />
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** One-line severity summary: "1 critical · 2 high · 1 medium". */
export function AttentionSummary({
  counts,
  className,
}: {
  counts: Record<FindingSeverity, number>;
  className?: string;
}) {
  const order: FindingSeverity[] = ["critical", "high", "medium"];
  const shown = order.filter((severity) => counts[severity] > 0);
  if (shown.length === 0) {
    return <span className={cn("text-xs text-success", className)}>No issues require review</span>;
  }
  return (
    <span className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs", className)}>
      {shown.map((severity) => (
        <span key={severity} className={cn("inline-flex items-center gap-1", SEVERITY_STYLE[severity].text)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", SEVERITY_STYLE[severity].dot)} aria-hidden />
          {counts[severity]} {SEVERITY_LABELS[severity].toLowerCase()}
        </span>
      ))}
    </span>
  );
}
