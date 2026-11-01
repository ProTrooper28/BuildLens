import { cn } from "@/lib/utils";
import { STATUS_TONE, VERDICT_TONE } from "@/components/evaluation/status-tone";
import {
  CHECK_STATUS_LABELS,
  type CheckStatus,
  type VerdictTone,
} from "@/services/inspection/types";

/**
 * Status language for the judging screens.
 *
 * A status is a dot plus a short label rather than a filled pill, so a page with
 * twenty findings still reads calmly. The palette itself lives in status-tone.ts
 * so the compact deployment list and these labels can never drift apart.
 */

export function StatusMark({
  status,
  label,
  className,
}: {
  status: CheckStatus;
  label?: string | undefined;
  className?: string | undefined;
}) {
  const tone = STATUS_TONE[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-medium",
        tone.text,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} aria-hidden />
      {label ?? CHECK_STATUS_LABELS[status]}
    </span>
  );
}

export function CheckStatusBadge({
  status,
  className,
}: {
  status: CheckStatus;
  className?: string | undefined;
}) {
  return <StatusMark status={status} className={className} />;
}

export function VerdictToneBadge({
  tone,
  label,
  className,
}: {
  tone: VerdictTone;
  label: string;
  className?: string | undefined;
}) {
  const style = VERDICT_TONE[tone];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-medium",
        style.text,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} aria-hidden />
      {label}
    </span>
  );
}

const BASIS_LABEL = {
  observed: "Observed",
  inferred: "Inferred",
  not_detected: "Not detected",
  could_not_verify: "Could not verify",
} as const;

/** How a finding was reached: read directly, inferred from code, or unread. */
export function EvidenceBasisChip({
  basis,
  className,
}: {
  basis: keyof typeof BASIS_LABEL;
  className?: string | undefined;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground",
        className,
      )}
    >
      {BASIS_LABEL[basis]}
    </span>
  );
}
