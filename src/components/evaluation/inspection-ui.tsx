import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  HelpCircle,
  Info,
  MinusCircle,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CHECK_STATUS_LABELS,
  type CheckStatus,
  type DeploymentRow,
  type DeploymentRowId,
  type VerdictTone,
} from "@/services/inspection/types";

/**
 * Small shared pieces for the judge summary and the detailed analysis, so both
 * views speak exactly the same status language.
 */

const STATUS_STYLE: Record<
  CheckStatus,
  { icon: typeof CheckCircle2; className: string }
> = {
  supported: { icon: CheckCircle2, className: "border-success/30 bg-success/10 text-success" },
  good: { icon: CheckCircle2, className: "border-success/30 bg-success/10 text-success" },
  partially_supported: {
    icon: CircleDashed,
    className: "border-warning/30 bg-warning/10 text-warning",
  },
  warning: { icon: AlertTriangle, className: "border-warning/30 bg-warning/10 text-warning" },
  critical: { icon: XCircle, className: "border-destructive/30 bg-destructive/10 text-destructive" },
  not_detected: {
    icon: CircleSlash,
    className: "border-border bg-muted/50 text-muted-foreground",
  },
  not_found: { icon: MinusCircle, className: "border-border bg-muted/60 text-muted-foreground" },
  could_not_verify: {
    icon: HelpCircle,
    className: "border-primary/25 bg-primary/[0.07] text-primary",
  },
  info: { icon: Info, className: "border-border bg-muted/40 text-muted-foreground" },
};

export function CheckStatusBadge({ status }: { status: CheckStatus }) {
  const { icon: Icon, className } = STATUS_STYLE[status];
  return (
    <Badge variant="outline" className={cn("shrink-0 gap-1 whitespace-nowrap", className)}>
      <Icon className="h-3 w-3" aria-hidden />
      {CHECK_STATUS_LABELS[status]}
    </Badge>
  );
}

const BASIS_STYLE: Record<
  "observed" | "inferred" | "not_detected" | "could_not_verify",
  { label: string; className: string }
> = {
  observed: { label: "Observed", className: "border-success/25 bg-success/8 text-success" },
  inferred: { label: "Inferred", className: "border-primary/25 bg-primary/8 text-primary" },
  not_detected: { label: "Not detected", className: "border-border bg-muted/50 text-muted-foreground" },
  could_not_verify: { label: "Could not verify", className: "border-primary/20 bg-primary/[0.06] text-primary" },
};

export function EvidenceBasisChip({
  basis,
}: {
  basis: keyof typeof BASIS_STYLE;
}) {
  const { label, className } = BASIS_STYLE[basis];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        className,
      )}
    >
      {label}
    </span>
  );
}

const TONE_STYLE: Record<VerdictTone, string> = {
  strong: "border-success/30 bg-success/10 text-success",
  promising: "border-primary/30 bg-primary/10 text-primary",
  mixed: "border-warning/30 bg-warning/10 text-warning",
  limited: "border-border bg-muted/60 text-muted-foreground",
  unverified: "border-border bg-muted/60 text-muted-foreground",
};

export function VerdictToneBadge({ tone, label }: { tone: VerdictTone; label: string }) {
  return (
    <Badge variant="outline" className={cn("shrink-0", TONE_STYLE[tone])}>
      {label}
    </Badge>
  );
}

const ROW_LABEL: Record<DeploymentRowId, string> = {
  availability: "Availability",
  https: "HTTPS",
  response: "Page response",
  performance: "Performance",
  functionality: "Functionality",
  security: "Security",
  mobile: "Mobile / responsive",
};

export function DeploymentRowRow({
  row,
  basis,
}: {
  row: DeploymentRow;
  basis: "observed" | "inferred" | "not_detected" | "could_not_verify";
}) {
  const basisLabel = BASIS_STYLE[basis].label;
  return (
    <div className="grid gap-1 rounded-lg border border-border/70 bg-card/40 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">{ROW_LABEL[row.id]}</span>
            <span className="text-[10px] text-muted-foreground">{basisLabel}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{row.detail}</p>
        </div>
        <div className="shrink-0">
          <CheckStatusBadge status={row.status} />
        </div>
      </div>
      <p className="mt-0.5 text-xs font-medium text-foreground/80">{row.value}</p>
    </div>
  );
}

