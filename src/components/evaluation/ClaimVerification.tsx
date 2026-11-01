import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  HelpCircle,
  MinusCircle,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  CLAIM_SOURCE_FINDING_LABELS,
  CLAIM_VERDICT_LABELS,
  type ClaimSourceFinding,
  type ClaimVerdict,
} from "@/services/evidence/types";
import type { ClaimVerificationRow, VerdictCounts } from "@/services/inspection/types";

/**
 * CLAIM VERIFICATION.
 *
 * CANDIDATE SAID IT ≠ BUILDLENS VERIFIED IT. Every claim keeps the place the
 * candidate stated it, what the repository showed, what the deployed app showed
 * and the verdict — in one auditable table. Expanding a row reveals the file
 * paths, quotes and the evidence that is still missing.
 */

const VERDICT_STYLE: Record<ClaimVerdict, { icon: typeof CheckCircle2; className: string }> = {
  verified: { icon: CheckCircle2, className: "border-success/30 bg-success/10 text-success" },
  partially_verified: {
    icon: CircleDashed,
    className: "border-warning/30 bg-warning/10 text-warning",
  },
  unverified: { icon: HelpCircle, className: "border-border bg-muted/60 text-muted-foreground" },
  unsupported: { icon: AlertTriangle, className: "border-warning/30 bg-warning/10 text-warning" },
  contradicted: {
    icon: XCircle,
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
};

export function VerdictChip({ verdict, label }: { verdict: ClaimVerdict; label?: string }) {
  const { icon: Icon, className } = VERDICT_STYLE[verdict];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {label ?? CLAIM_VERDICT_LABELS[verdict]}
    </span>
  );
}

const SOURCE_TONE: Record<ClaimSourceFinding, string> = {
  found: "text-success",
  partial: "text-warning",
  not_found: "text-muted-foreground",
  not_checked: "text-muted-foreground/70",
};

function SourceCell({ finding }: { finding: ClaimSourceFinding }) {
  return (
    <span className={cn("text-xs", SOURCE_TONE[finding])}>
      {CLAIM_SOURCE_FINDING_LABELS[finding]}
      {finding === "not_found" ? " —" : ""}
    </span>
  );
}

export function ClaimVerification({
  claims,
  counts,
  id = "claim-verification",
}: {
  claims: ClaimVerificationRow[];
  counts: VerdictCounts & { total: number };
  id?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section id={id} className="scroll-mt-24">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Claim verification</h2>
        <p className="text-[11px] text-muted-foreground">
          {counts.total} claim{counts.total === 1 ? "" : "s"} identified
        </p>
      </div>

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <li className="text-success">{counts.verified} verified</li>
        <li className="text-warning">{counts.partially_verified} partially verified</li>
        <li className="text-muted-foreground">{counts.unverified} unverified</li>
        <li className="text-warning">{counts.unsupported} unsupported</li>
        <li className="text-destructive">{counts.contradicted} contradicted</li>
      </ul>

      {claims.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-border/70 px-3 py-4 text-xs text-muted-foreground">
          No checkable claims were submitted, so nothing was marked verified or missing.
        </p>
      ) : (
        <div className="mt-3 overflow-hidden rounded-lg border border-border/70">
          <table className="w-full table-fixed border-collapse text-left">
            <caption className="sr-only">
              Every claim the candidate made, where they made it, and what each independent source
              showed.
            </caption>
            <thead>
              <tr className="border-b border-border/70 bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="w-[42%] px-3 py-2 font-medium">
                  Claim
                </th>
                <th scope="col" className="hidden w-[16%] px-2 py-2 font-medium sm:table-cell">
                  Source
                </th>
                <th scope="col" className="hidden w-[14%] px-2 py-2 font-medium md:table-cell">
                  Repository
                </th>
                <th scope="col" className="hidden w-[12%] px-2 py-2 font-medium md:table-cell">
                  Live app
                </th>
                <th scope="col" className="w-[28%] px-3 py-2 font-medium">
                  Verdict
                </th>
                <th scope="col" className="w-8 px-1 py-2">
                  <span className="sr-only">Expand</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {claims.map((claim) => {
                const expanded = open === claim.id;
                return (
                  <ClaimTableRow
                    key={claim.id}
                    claim={claim}
                    expanded={expanded}
                    onToggle={() => setOpen(expanded ? null : claim.id)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        “Unverified” means the readable evidence did not show the claim, or no source could be
        read — it is not proof that the claim is false. “Contradicted” means the evidence actually
        conflicts with what was claimed.
      </p>
    </section>
  );
}

function ClaimTableRow({
  claim,
  expanded,
  onToggle,
}: {
  claim: ClaimVerificationRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className={cn("border-b border-border/60 align-top", expanded && "bg-muted/20")}>
        <td className="px-3 py-2.5">
          <p className="text-xs font-medium leading-snug text-foreground/90">{claim.claim}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {claim.claimType}
          </p>
        </td>
        <td className="hidden px-2 py-2.5 sm:table-cell">
          <span className="text-xs text-muted-foreground">{claim.source}</span>
        </td>
        <td className="hidden px-2 py-2.5 md:table-cell">
          <SourceCell finding={claim.repository} />
        </td>
        <td className="hidden px-2 py-2.5 md:table-cell">
          <SourceCell finding={claim.liveApp} />
        </td>
        <td className="px-3 py-2.5">
          <VerdictChip verdict={claim.verdict} label={claim.verdictLabel} />
        </td>
        <td className="px-1 py-2.5">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={expanded ? `Hide evidence for ${claim.claim}` : `Show evidence for ${claim.claim}`}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/60 bg-muted/10">
          <td colSpan={6} className="px-3 py-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <DetailGroup label="Candidate claim">
                <p className="text-xs leading-relaxed text-foreground/85">{claim.claim}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {claim.source}
                  {claim.pageRefs.length > 0 ? ` · slide ${claim.pageRefs.join(", ")}` : ""}
                </p>
              </DetailGroup>

              <DetailGroup label="Verdict">
                <div className="flex items-center gap-2">
                  <VerdictChip verdict={claim.verdict} label={claim.verdictLabel} />
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {claim.note}
                </p>
              </DetailGroup>

              <DetailGroup label="Evidence found">
                {claim.evidenceRefs.length === 0 && claim.quotes.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    No evidence location was recorded for this claim.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {claim.evidenceRefs.map((ref) => (
                      <li key={ref} className="break-words font-mono text-[11px] text-foreground/75">
                        {ref}
                      </li>
                    ))}
                    {claim.quotes.map((quote, index) => (
                      <li
                        key={`${claim.id}-quote-${index}`}
                        className="border-l-2 border-primary/20 pl-2 text-[11px] leading-snug text-foreground/70"
                      >
                        “{quote}”
                      </li>
                    ))}
                  </ul>
                )}
              </DetailGroup>

              <DetailGroup label="Missing evidence">
                {claim.missingEvidence.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    Nothing is missing — the readable sources support this claim.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {claim.missingEvidence.map((item) => (
                      <li key={item} className="flex gap-1.5 text-[11px] leading-snug text-muted-foreground">
                        <MinusCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
                {claim.contradiction && (
                  <p className="mt-1.5 flex gap-1.5 text-[11px] leading-snug text-destructive">
                    <XCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                    {claim.contradiction}
                  </p>
                )}
              </DetailGroup>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DetailGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
