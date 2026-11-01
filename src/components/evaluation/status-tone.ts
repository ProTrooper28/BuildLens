import type { CheckStatus, VerdictTone } from "@/services/inspection/types";

/**
 * The status palette for the judging screens — one place, one meaning.
 *
 * Supported / good reads green, partial or warning reads amber, not found and
 * critical read red, and anything that could not be verified stays neutral grey
 * (a missing source is a gap in the evidence, not a failure by the team).
 */

export const STATUS_TONE: Record<CheckStatus, { dot: string; text: string }> = {
  supported: { dot: "bg-success", text: "text-success" },
  good: { dot: "bg-success", text: "text-success" },
  partially_supported: { dot: "bg-warning", text: "text-warning" },
  warning: { dot: "bg-warning", text: "text-warning" },
  critical: { dot: "bg-destructive", text: "text-destructive" },
  not_found: { dot: "bg-destructive", text: "text-destructive" },
  not_detected: { dot: "bg-muted-foreground/45", text: "text-muted-foreground" },
  could_not_verify: { dot: "bg-muted-foreground/45", text: "text-muted-foreground" },
  info: { dot: "bg-muted-foreground/45", text: "text-muted-foreground" },
};

export const VERDICT_TONE: Record<VerdictTone, { dot: string; text: string }> = {
  strong: { dot: "bg-success", text: "text-success" },
  promising: { dot: "bg-primary", text: "text-primary" },
  mixed: { dot: "bg-warning", text: "text-warning" },
  limited: { dot: "bg-muted-foreground/45", text: "text-muted-foreground" },
  unverified: { dot: "bg-muted-foreground/45", text: "text-muted-foreground" },
};

/** The dot alone, for dense rows that already carry their label. */
export function statusDotClass(status: CheckStatus): string {
  return STATUS_TONE[status].dot;
}
