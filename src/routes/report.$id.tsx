import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState, Suspense, type ReactNode } from "react";
import { flushSync } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Check,
  ChevronDown,
  ClipboardCheck,
  Copy,
  Download,
  FileCheck2,
  FileText,
  FileWarning,
  Gauge,
  Github,
  Globe,
  Info,
  Layers,
  ListChecks,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { Accordion } from "@radix-ui/react-accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AppLayout } from "@/components/layout/AppLayout";
import { BrandMark } from "@/components/brand/BrandLogo";
import { ScoreRing } from "@/components/ScoreRing";
import { ReportSection } from "@/components/report/ReportSection";
import { ErrorState } from "@/components/state/ErrorState";
import {
  AmbientCard,
  EvaluationPipeline,
  LoadingState,
  type PipelineStage,
} from "@/components/motion/primitives";
import { PerformanceChart } from "@/components/Charts";
import { getReportSummary, getReport, type ReportSummary } from "@/services/report.service";
import { getGuestReport, type GuestReport } from "@/services/guest.service";
import { isSupabaseConfigured } from "@/lib/supabase";
import { normalizeReportData, normalizeReportStatus, type RiskSeverity } from "@/lib/report-data";
import {
  buildReportInsights,
  type ClaimResult,
  type FindingTone,
  type MetricStatus,
  type RepositoryCheck,
  type VerdictTone,
} from "@/lib/report-insights";
import { useAuth } from "@/hooks/useAuth";
import type { Report as ReportRow } from "@/types/database";
import { notify } from "@/lib/toast-messages";
import {
  buildReportExportHtml,
  buildReportShareUrl,
  copyTextToClipboard,
  downloadReportFile,
  reportExportFilename,
} from "@/lib/report-share";

interface ReportLoaderData {
  row: ReportSummary | null;
  error: string | null;
}

/** Read the analyst payload from whichever row shape we have (summary rows omit it). */
function reportDataOf(
  row: ReportSummary | ReportRow | GuestReport | null,
): ReportRow["report_data"] | null {
  if (!row || !("report_data" in row)) return null;
  return row.report_data ?? null;
}

export const Route = createFileRoute("/report/$id")({
  head: () => ({
    meta: [
      { title: "Technical Report — BuildLens" },
      {
        name: "description",
        content:
          "Scores, verified features, strengths, weaknesses and questions for the evaluated project.",
      },
      { property: "og:title", content: "Technical Report — BuildLens" },
      { property: "og:description", content: "Viewing a BuildLens report." },
    ],
  }),
  component: Report,
  loader: async ({ params }): Promise<ReportLoaderData> => {
    // Without Supabase there is nothing to query — guest reports live in this
    // browser and are resolved by the component after mount.
    if (!isSupabaseConfigured) return { row: null, error: null };
    try {
      // Summary only: the initial request deliberately excludes the large
      // `report_data` JSON so the page shell can paint instantly. The full
      // analyst payload is fetched on demand (see below).
      return { row: await getReportSummary(params.id), error: null };
    } catch (error) {
      console.error(error);
      return {
        row: null,
        error: error instanceof Error ? error.message : "We couldn't load this report.",
      };
    }
  },
});

/** Format an ISO timestamp as a short, locale-aware date. */
function formatDate(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Detail sections the page opens by default (the summary is not collapsible). */
const DEFAULT_OPEN_SECTIONS: string[] = [];

/** Every collapsible section, expanded for printing so nothing is cut off. */
const ALL_SECTIONS = [
  "functionality",
  "deployment",
  "performance",
  "security",
  "code",
  "documentation",
  "evidence",
  "pipeline",
];

const listIcon = "mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary";

/* ------------------------------------------------------------- presentation */

const VERDICT_TONE: Record<VerdictTone, string> = {
  verified: "border-success/40 bg-success/10 text-success",
  partial: "border-warning/40 bg-warning/10 text-warning",
  unverified: "border-destructive/40 bg-destructive/10 text-destructive",
  unknown: "border-border bg-muted/50 text-muted-foreground",
};

const FINDING_TONE: Record<FindingTone, { label: string; dot: string; text: string }> = {
  critical: { label: "Critical", dot: "bg-destructive", text: "text-destructive" },
  important: { label: "Important", dot: "bg-warning", text: "text-warning" },
  positive: { label: "Positive", dot: "bg-success", text: "text-success" },
};

const SEVERITY_BADGE: Record<RiskSeverity, string> = {
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  high: "border-destructive/30 bg-destructive/10 text-destructive",
  medium: "border-warning/30 bg-warning/10 text-warning",
  low: "border-border bg-muted/50 text-muted-foreground",
  unknown: "border-border bg-muted/50 text-muted-foreground",
};

const REPOSITORY_MARK: Record<
  RepositoryCheck,
  { glyph: string; label: string; className: string }
> = {
  verified: { glyph: "✓", label: "Found in repository", className: "text-success" },
  partial: { glyph: "◐", label: "Partially found in repository", className: "text-warning" },
  not_found: { glyph: "✕", label: "Not found in repository", className: "text-destructive" },
  unverified: { glyph: "?", label: "Not checked", className: "text-muted-foreground" },
};

const METRIC_STATUS: Record<MetricStatus, { dot: string; label: string; className: string }> = {
  good: { dot: "bg-success", label: "Good", className: "text-success" },
  needs_improvement: {
    dot: "bg-warning",
    label: "Needs improvement",
    className: "text-warning",
  },
  poor: { dot: "bg-destructive", label: "Poor", className: "text-destructive" },
  not_measured: {
    dot: "bg-muted-foreground/50",
    label: "Not measured",
    className: "text-muted-foreground",
  },
};

const DOC_STATE: Record<"present" | "partial" | "missing", { glyph: string; className: string }> = {
  present: { glyph: "✓", className: "text-success" },
  partial: { glyph: "⚠", className: "text-warning" },
  missing: { glyph: "✕", className: "text-destructive" },
};

function SectionHeading({ index, title, hint }: { index: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="flex items-baseline gap-2 text-[13px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <span className="font-mono text-[11px] text-primary/70">{index}</span>
        {title}
      </h2>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function EmptyNote({ children }: { children?: string }) {
  return (
    <p className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
      {children ?? "No evidence was collected for this section."}
    </p>
  );
}

function BulletList({ items, icon }: { items: string[]; icon?: "check" | "cross" }) {
  return (
    <ul className="space-y-2">
      {items.map((item, k) => (
        <li key={`${item}-${k}`} className="flex gap-2.5 text-sm text-muted-foreground">
          {icon === "check" ? (
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          ) : icon === "cross" ? (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          ) : (
            <span className={listIcon} />
          )}
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function StatRow({
  label,
  value,
  tone = "neutral",
  note,
}: {
  label: string;
  value: ReactNode;
  tone?: "good" | "warning" | "bad" | "neutral";
  note?: string | null;
}) {
  const toneClass =
    tone === "good"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "bad"
          ? "text-destructive"
          : "text-foreground";
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border/50 py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium tabular-nums ${toneClass}`}>{value}</span>
      {note && <span className="w-full text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}

/** One claim in the verification table: verdict up top, evidence when opened. */
function ClaimTableRow({ result }: { result: ClaimResult }) {
  const { claim, verdict, repository } = result;
  const mark = REPOSITORY_MARK[repository];
  const sources = claim.sources?.length
    ? claim.sources
    : claim.source
      ? [{ source: claim.source, location: claim.sourceLocation ?? null }]
      : [];

  return (
    <li className="border-b border-border/50 last:border-0">
      <details className="group">
        <summary className="grid cursor-pointer list-none items-center gap-x-4 gap-y-1 px-1 py-3 transition-colors hover:bg-muted/20 md:grid-cols-[minmax(0,1fr)_6.5rem_6rem_6rem_8rem] [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-start gap-2 text-sm font-medium leading-snug">
            <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            <span className="min-w-0">{claim.claim}</span>
          </span>
          <span className="pl-5 text-xs text-muted-foreground md:pl-0">
            <span className="md:hidden">Source: </span>
            {result.sourceLabel}
          </span>
          <span className={`pl-5 text-sm md:pl-0 ${mark.className}`} title={mark.label}>
            <span className="md:hidden">Repository: </span>
            <span aria-hidden>{mark.glyph}</span>
            <span className="sr-only">{mark.label}</span>
          </span>
          <span
            className="pl-5 text-sm text-muted-foreground md:pl-0"
            title="The deployed application was not executed by this analysis."
          >
            <span className="md:hidden">Deployment: not tested</span>
            <span aria-hidden className="hidden md:inline">
              —
            </span>
            <span className="sr-only">Not tested on the deployment</span>
          </span>
          <span className="pl-5 md:pl-0">
            <Badge variant="outline" className={`text-[11px] ${VERDICT_TONE[verdict.tone]}`}>
              {verdict.label}
            </Badge>
          </span>
        </summary>
        <dl className="space-y-2 border-t border-border/40 bg-muted/10 px-1 py-3 text-xs md:ml-5">
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
            <dt className="w-40 shrink-0 text-muted-foreground">Sources</dt>
            <dd className="text-foreground/90">
              {sources.length === 0
                ? "Submission"
                : sources
                    .map((source) =>
                      source.location ? `${source.source} — ${source.location}` : source.source,
                    )
                    .join(" · ")}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
            <dt className="w-40 shrink-0 text-muted-foreground">Repository evidence</dt>
            <dd className="text-foreground/90">
              {claim.evidence ?? "No repository evidence was recorded for this claim."}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
            <dt className="w-40 shrink-0 text-muted-foreground">Deployment evidence</dt>
            <dd className="text-foreground/90">
              Not tested — this analysis inspects the repository and submitted documents, it does
              not click through the deployed application.
            </dd>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
            <dt className="w-40 shrink-0 text-muted-foreground">Result</dt>
            <dd className="text-foreground/90">{verdict.label}</dd>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
            <dt className="w-40 shrink-0 text-muted-foreground">Reason</dt>
            <dd className="text-foreground/90">{claim.reason ?? "No reason was recorded."}</dd>
          </div>
        </dl>
      </details>
    </li>
  );
}

function ReportState({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <AppLayout title={title} subtitle={subtitle} crumbs={[{ label: "Reports", to: "/reports" }]}>
      <div className="mx-auto max-w-lg py-10">{children}</div>
    </AppLayout>
  );
}

/* -------------------------------------------------------------------- page */

function Report() {
  const { row: loaderRow, error: loaderError } = Route.useLoaderData();
  const { id } = Route.useParams();
  const router = useRouter();
  const { user } = useAuth();

  // The loader can run on the server (or during hydration), where this browser's
  // guest submissions do not exist. When it found nothing, look in the guest store
  // again after mount so a refreshed guest report still opens. State starts empty so
  // the first client render matches the server HTML.
  const [guestRow, setGuestRow] = useState<GuestReport | null>(null);
  const [guestResolved, setGuestResolved] = useState(false);
  useEffect(() => {
    setGuestRow(loaderRow ? null : getGuestReport(id));
    setGuestResolved(true);
  }, [loaderRow, id]);

  const [reportData, setReportData] = useState<ReturnType<typeof normalizeReportData> | null>(null);
  const [fullRow, setFullRow] = useState<ReportRow | null>(null);
  // A summary row means the payload fetch is about to start — render skeletons
  // from the first paint instead of flashing empty sections.
  const [dataLoading, setDataLoading] = useState(loaderRow !== null);

  const reportRow: ReportSummary | ReportRow | GuestReport | null =
    fullRow ?? loaderRow ?? guestRow;

  const status = normalizeReportStatus(reportRow?.status);
  const view = reportData ?? normalizeReportData(reportDataOf(reportRow));
  const insights = buildReportInsights(view);

  useEffect(() => {
    if (!loaderRow) return;
    let cancelled = false;
    setDataLoading(true);
    getReport(loaderRow.id)
      .then((row) => {
        if (cancelled || !row) return;
        setFullRow(row);
        setReportData(normalizeReportData(row.report_data));
      })
      .catch(() => {
        // Keep the summary UI: a failure here never blocks the page.
      })
      .finally(() => {
        if (!cancelled) setDataLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loaderRow]);

  const [copying, setCopying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [openSections, setOpenSections] = useState<string[]>(DEFAULT_OPEN_SECTIONS);

  // Printing reveals every section (the DOM only holds open sections), then the
  // user's previous selection is restored. flushSync keeps the expansion inside
  // the synchronous `beforeprint` event.
  useEffect(() => {
    const expand = () => {
      flushSync(() => setOpenSections(ALL_SECTIONS));
    };
    const restore = () => setOpenSections(DEFAULT_OPEN_SECTIONS);
    window.addEventListener("beforeprint", expand);
    window.addEventListener("afterprint", restore);
    return () => {
      window.removeEventListener("beforeprint", expand);
      window.removeEventListener("afterprint", restore);
    };
  }, []);

  const shareReport = async () => {
    if (copying) return;
    const url = buildReportShareUrl(reportRow?.id);
    if (!url) {
      notify.error("Report link unavailable", "This report has no id to share.");
      return;
    }
    setCopying(true);
    try {
      const outcome = await copyTextToClipboard(url);
      if (outcome === "copied") {
        notify.success("Report link copied", "Anyone with the link can open this report.");
      } else {
        notify.error(
          "Couldn't copy the link",
          outcome === "denied"
            ? "Your browser blocked clipboard access. Copy the address bar URL instead."
            : "Clipboard access isn't available in this browser. Copy the address bar URL instead.",
        );
      }
    } finally {
      setCopying(false);
    }
  };

  const downloadReport = async () => {
    if (exporting || !reportRow) return;
    setExporting(true);
    try {
      // Yield once so the button can paint its busy state before the synchronous work.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const html = buildReportExportHtml({
        reportId: reportRow.id,
        name: reportRow.name,
        statusLabel: status.label,
        statusDescription: status.description,
        overall,
        view,
        shareUrl: buildReportShareUrl(reportRow.id),
        createdAt: formatDate(reportRow.created_at),
        exportedAt: formatDate(new Date().toISOString()),
      });
      const saved = downloadReportFile(reportExportFilename(reportRow.name, reportRow.id), html);
      if (saved) {
        notify.success(
          "Report downloaded",
          "Saved as a standalone HTML file you can print to PDF.",
        );
      } else {
        notify.error(
          "Couldn't download the report",
          "Your browser blocked the download. The report is still on screen.",
        );
      }
    } catch (error) {
      console.error(error);
      notify.error("Couldn't export this report", "The report is still available on screen.");
    } finally {
      setExporting(false);
    }
  };

  if (loaderError) {
    return (
      <ReportState title="Couldn't load this report" subtitle="The report service didn't respond.">
        <ErrorState
          title="Report service unavailable"
          description={loaderError}
          onRetry={() => {
            void router.invalidate();
          }}
        />
      </ReportState>
    );
  }

  if (!reportRow && !guestResolved) {
    return (
      <ReportState title="Loading report…" subtitle="Fetching the stored analysis.">
        <div
          className="flex flex-col items-center justify-center gap-4 py-16 text-sm text-muted-foreground"
          role="status"
        >
          <BrandMark size="xl" />
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading report…
          </span>
        </div>
      </ReportState>
    );
  }

  if (!reportRow) {
    // Guests only ever have browser-local rows: an unresolved guest id means the
    // report was created in another browser or that local storage was cleared.
    const guestContext = !user;
    return (
      <ReportState
        title="Report not found"
        subtitle="This report doesn't exist or isn't accessible."
      >
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-6 py-12 text-center">
          <FileWarning className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium">
            {guestContext ? "This report isn't available in this browser" : "Report not found"}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {guestContext
              ? "Guest reports are saved in this browser only. If local storage was cleared or you opened this link on another device, the report can't be recovered — you can submit the project again."
              : "It may have been deleted, or it belongs to another account. Your other reports are still available."}
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Button asChild variant="outline">
              <Link to="/reports">Back to reports</Link>
            </Button>
            <Button asChild>
              <Link to="/review/project">
                <Plus className="h-4 w-4" /> New project review
              </Link>
            </Button>
          </div>
        </div>
      </ReportState>
    );
  }

  const overall =
    insights.finalVerdict.score ??
    (typeof reportRow.score === "number" && Number.isFinite(reportRow.score)
      ? Math.round(reportRow.score)
      : view.scores.overall);

  const claimPipeline = view.claimPipeline;
  const claimCounts = insights.claimCounts;
  const running = status.kind === "in_progress";
  const claimStageState = (done: boolean): PipelineStage["state"] =>
    done ? "done" : running ? "active" : claimPipeline?.error ? "error" : "pending";

  const pipelineStages: PipelineStage[] = [
    {
      label: "Evidence gathered",
      icon: <ShieldCheck className="h-3.5 w-3.5" />,
      state:
        view.hasPayloadData || view.claims.length > 0 ? "done" : running ? "active" : "pending",
    },
    {
      label: "Documents processed",
      icon: <FileText className="h-3.5 w-3.5" />,
      detail: view.documentAnalysis
        ? `${view.documentAnalysis.fileName ?? "Submitted document"} read`
        : "No document attached",
      state: view.documentAnalysis ? "done" : running ? "active" : "pending",
    },
    {
      label: "Claims extracted",
      icon: <ClipboardCheck className="h-3.5 w-3.5" />,
      detail: claimPipeline
        ? `${claimPipeline.extracted} extracted · ${claimPipeline.deduped} merged`
        : `${claimCounts.total} claims`,
      state: claimStageState(claimPipeline ? claimPipeline.extracted > 0 : claimCounts.total > 0),
    },
    {
      label: "Claims verified",
      icon: <ListChecks className="h-3.5 w-3.5" />,
      detail: claimPipeline
        ? `${claimPipeline.verified} of ${claimPipeline.registered} decided`
        : `${claimCounts.supported + claimCounts.partial + claimCounts.unsupported} decided`,
      state: claimStageState(claimPipeline ? claimPipeline.verified > 0 : claimCounts.total > 0),
    },
    {
      label: "Repository analyzed",
      icon: <Github className="h-3.5 w-3.5" />,
      state: view.repository || view.evidence?.repository ? "done" : running ? "active" : "pending",
    },
    {
      label: "Project evaluated",
      icon: <ListChecks className="h-3.5 w-3.5" />,
      state: view.hasPayloadData ? "done" : running ? "active" : "pending",
    },
    {
      label: "Report generated",
      icon: <FileCheck2 className="h-3.5 w-3.5" />,
      state:
        status.kind === "completed"
          ? "done"
          : status.kind === "failed"
            ? "error"
            : running
              ? "active"
              : "pending",
    },
  ];

  const statusEdge =
    status.kind === "completed"
      ? "border-success/30 bg-success/5"
      : status.kind === "failed"
        ? "border-destructive/30 bg-destructive/5"
        : status.kind === "in_progress"
          ? "border-warning/30 bg-warning/5"
          : "border-border bg-muted/30";

  const { performance, scoreboard, deployment, security, documentation, codeQuality } = insights;
  const measuredMetrics = performance.filter((metric) => metric.status !== "not_measured");

  return (
    <AppLayout
      title={reportRow.name}
      subtitle={`${reportRow.project_id ? "Project report" : "Developer report"} · Generated ${formatDate(reportRow.created_at)}`}
      crumbs={[{ label: "Reports", to: "/reports" }, { label: reportRow.name }]}
      actions={
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void shareReport()}
            disabled={copying}
            aria-label="Share report"
          >
            {copying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            {copying ? "Copying…" : "Share Report"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void downloadReport()}
            disabled={exporting}
            aria-label="Download report"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {exporting ? "Preparing…" : "Download Report"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void router.invalidate()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Status banner */}
        <div
          className={`flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3 ${statusEdge}`}
        >
          <span
            className={
              status.kind === "failed"
                ? "text-destructive"
                : status.kind === "in_progress"
                  ? "text-warning"
                  : status.kind === "completed"
                    ? "text-success"
                    : "text-muted-foreground"
            }
          >
            {status.kind === "failed" ? (
              <AlertTriangle className="mt-0.5 h-4 w-4" />
            ) : status.kind === "in_progress" ? (
              <Loader2 className="mt-0.5 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <Badge variant="outline" className={`text-xs ${status.badgeClass}`}>
                {status.label}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {view.hasPayloadData ? "Report data" : "Awaiting analysis data"}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{status.description}</p>
            {view.analysis?.error && (
              <p className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <strong>{view.analysis.error.message}</strong>
                {view.analysis.error.hint ? ` ${view.analysis.error.hint}` : ""}
              </p>
            )}
          </div>
          {running ? (
            <Button asChild variant="outline" size="sm" className="print:hidden">
              <Link
                to="/progress"
                search={{ projectId: reportRow.project_id ?? undefined, reportId: reportRow.id }}
              >
                View progress
              </Link>
            </Button>
          ) : status.kind === "failed" ? (
            <Button asChild variant="outline" size="sm" className="print:hidden">
              <Link to="/review/project">Start a new review</Link>
            </Button>
          ) : null}
        </div>

        {dataLoading && !view.hasPayloadData && (
          <div className="surface p-6">
            <LoadingState label="Loading report analysis…" rows={6} />
          </div>
        )}

        {/* ── LEVEL 1 · 1. EXECUTIVE SUMMARY ─────────────────────────────── */}
        <AmbientCard className="surface overflow-hidden p-0">
          <div className="grid gap-6 p-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
            <div className="flex items-center gap-5 lg:flex-col lg:items-start lg:border-r lg:border-border/60 lg:pr-6">
              <ScoreRing value={overall} label="/ 100" />
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Overall score
                </p>
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                  {overall === null ? "—" : overall}
                  <span className="text-sm font-normal text-muted-foreground">/100</span>
                </p>
                {overall === null && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No score stored for this report.
                  </p>
                )}
                <p className="mt-3 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Verdict
                </p>
                <Badge
                  variant="outline"
                  className={`mt-1 text-[11px] font-semibold uppercase tracking-wide ${VERDICT_TONE[insights.verdict.tone]}`}
                >
                  {insights.verdict.label}
                </Badge>
              </div>
            </div>

            <div className="min-w-0">
              <SectionHeading index="01" title="Executive summary" hint={status.label} />
              <div className="mt-3 space-y-2">
                {insights.summary.map((sentence, index) => (
                  <p key={index} className="text-sm leading-relaxed text-foreground/90">
                    {sentence}
                  </p>
                ))}
              </div>

              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Most important findings
              </p>
              <ul className="mt-2 space-y-2">
                {insights.findings.map((finding, index) => {
                  const tone = FINDING_TONE[finding.tone];
                  return (
                    <li
                      key={`${finding.title}-${index}`}
                      className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
                    >
                      <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-snug">{finding.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          <span className={`font-semibold uppercase tracking-wide ${tone.text}`}>
                            {tone.label}
                          </span>
                          {finding.detail ? ` · ${finding.detail}` : ""}
                        </p>
                      </div>
                    </li>
                  );
                })}
                {insights.findings.length === 0 && (
                  <li>
                    <EmptyNote>No findings were recorded for this submission.</EmptyNote>
                  </li>
                )}
              </ul>
            </div>
          </div>
        </AmbientCard>

        {/* ── LEVEL 1 · 2. SCORE BREAKDOWN ───────────────────────────────── */}
        <section className="surface p-6">
          <SectionHeading
            index="02"
            title="Score breakdown"
            hint={`${scoreboard.points} of ${scoreboard.measuredMax} possible points`}
          />
          <ul className="mt-4 divide-y divide-border/50">
            {scoreboard.categories.map((category) => {
              const pct =
                category.points === null ? 0 : Math.round((category.points / category.max) * 100);
              return (
                <li key={category.key}>
                  <details className="group">
                    <summary className="grid cursor-pointer list-none items-center gap-x-4 gap-y-1 py-2.5 [&::-webkit-details-marker]:hidden sm:grid-cols-[10rem_minmax(0,1fr)_5rem]">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                        {category.label}
                      </span>
                      <span className="flex items-center gap-3 pl-5 sm:pl-0">
                        <Progress
                          value={pct}
                          className="h-1.5 flex-1"
                          aria-label={`${category.label} score`}
                        />
                      </span>
                      <span className="pl-5 text-right text-sm font-mono tabular-nums sm:pl-0">
                        {category.points === null ? (
                          <span className="text-xs text-muted-foreground">Not measured</span>
                        ) : (
                          <>
                            <span className="font-semibold">{category.points}</span>
                            <span className="text-muted-foreground">/{category.max}</span>
                          </>
                        )}
                      </span>
                    </summary>
                    <div className="pb-3 pl-5 sm:pl-6">
                      <p className="text-xs text-muted-foreground">{category.rationale}</p>
                      {category.evidence.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {category.evidence.map((item) => (
                            <li key={item} className="text-xs text-muted-foreground">
                              · {item}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
          {view.scoreboard === null && view.scores.overall !== null && (
            <p className="mt-3 text-xs text-muted-foreground">
              This report predates the six-category score, so its categories are recomputed from the
              stored evidence while the overall score stays the one recorded with the report.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-border/60 pt-3">
            <span className="text-sm font-semibold uppercase tracking-wide">Overall</span>
            <span className="font-mono text-sm tabular-nums">
              <span className="text-base font-semibold">{overall ?? "—"}</span>
              <span className="text-muted-foreground">/100</span>
              {scoreboard.measuredMax < 100 && (
                <span className="ml-2 text-xs text-muted-foreground">
                  ({scoreboard.measuredMax} of 100 points measurable)
                </span>
              )}
            </span>
          </div>
        </section>

        {/* ── LEVEL 1 · 3. CLAIM VERIFICATION ────────────────────────────── */}
        <section className="surface p-6">
          <SectionHeading
            index="03"
            title="Claim verification"
            hint="Each claim opens to its evidence"
          />
          {claimPipeline?.error ? (
            <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <strong>Pipeline error:</strong> {claimPipeline.error}
            </p>
          ) : claimCounts.total === 0 ? (
            <div className="mt-3">
              <EmptyNote>
                No claims were extracted from the submitted deck, the README or the submission form,
                so there was nothing to verify.
              </EmptyNote>
            </div>
          ) : (
            <>
              <p className="mt-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {claimCounts.total} claim{claimCounts.total === 1 ? "" : "s"} analyzed
                </span>
                {" · "}
                <span className="text-success">✓ {claimCounts.supported} verified</span>
                {" · "}
                <span className="text-warning">⚠ {claimCounts.partial} partially verified</span>
                {" · "}
                <span className="text-destructive">✕ {claimCounts.unsupported} unsupported</span>
                {claimCounts.could_not_verify > 0 && (
                  <>
                    {" · "}
                    <span className="text-muted-foreground">
                      ? {claimCounts.could_not_verify} could not be verified
                    </span>
                  </>
                )}
              </p>

              <div className="mt-4">
                <div className="hidden grid-cols-[minmax(0,1fr)_6.5rem_6rem_6rem_8rem] gap-x-4 border-b border-border/70 px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid">
                  <span>Claim</span>
                  <span>Source</span>
                  <span>Repository</span>
                  <span>Deployment</span>
                  <span>Verdict</span>
                </div>
                <ul>
                  {insights.claims.map((result, index) => (
                    <ClaimTableRow key={`${result.claim.claim}-${index}`} result={result} />
                  ))}
                </ul>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                A statement in the PPT, the README or the submission form is a claim, never proof.
                Repository evidence is a file-path and stack match; the deployed application was not
                executed, so deployment checks are marked as not tested.
                {claimPipeline && claimPipeline.deduped > 0
                  ? ` ${claimPipeline.extracted} claims were extracted and ${claimPipeline.deduped} merged as duplicates.`
                  : ""}
              </p>
            </>
          )}
        </section>

        {/* ── LEVEL 2 · DETAILED SECTIONS ────────────────────────────────── */}
        <div className="surface px-6">
          <Accordion
            type="multiple"
            value={openSections}
            onValueChange={setOpenSections}
            className="divide-y divide-border/60"
          >
            {/* 04 · Functionality */}
            <ReportSection
              value="functionality"
              title="Functionality"
              icon={<ClipboardCheck className="h-4 w-4" />}
              count={insights.features.length}
            >
              <p className="text-sm text-muted-foreground">
                {insights.features.length === 0
                  ? "No feature claims were submitted, so there was nothing to test."
                  : `${insights.features.length} claimed feature${insights.features.length === 1 ? "" : "s"} were checked against the repository (file paths and detected stack). None were executed on the deployed application.`}
              </p>
              {insights.features.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {insights.features.map((feature, index) => {
                    const state =
                      feature.verdict === "working"
                        ? { glyph: "✓", className: "text-success" }
                        : feature.verdict === "partial"
                          ? { glyph: "⚠", className: "text-warning" }
                          : feature.verdict === "not_found"
                            ? { glyph: "✕", className: "text-destructive" }
                            : { glyph: "?", className: "text-muted-foreground" };
                    return (
                      <li key={`${feature.claim}-${index}`}>
                        <details className="group rounded-lg border border-border/70 bg-card/40">
                          <summary className="flex cursor-pointer list-none items-start gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                            <span
                              className={`mt-0.5 text-sm font-semibold ${state.className}`}
                              aria-hidden
                            >
                              {state.glyph}
                            </span>
                            <span className="min-w-0 flex-1 text-sm font-medium leading-snug">
                              {feature.claim}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {feature.verdictLabel}
                            </span>
                            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                          </summary>
                          <dl className="space-y-2 border-t border-border/50 px-3 py-3 text-xs">
                            <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                              <dt className="w-36 shrink-0 text-muted-foreground">Claim</dt>
                              <dd className="text-foreground/90">{feature.expected}</dd>
                            </div>
                            <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                              <dt className="w-36 shrink-0 text-muted-foreground">
                                What was tested
                              </dt>
                              <dd className="text-foreground/90">{feature.tested}</dd>
                            </div>
                            <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                              <dt className="w-36 shrink-0 text-muted-foreground">Observed</dt>
                              <dd className="text-foreground/90">{feature.observed}</dd>
                            </div>
                            <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                              <dt className="w-36 shrink-0 text-muted-foreground">Verdict</dt>
                              <dd className="text-foreground/90">{feature.verdictLabel}</dd>
                            </div>
                          </dl>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ReportSection>

            {/* 05 · Deployment & runtime */}
            <ReportSection
              value="deployment"
              title="Deployment & runtime"
              icon={<Globe className="h-4 w-4" />}
            >
              <div>
                {deployment.rows.map((row) => (
                  <StatRow
                    key={row.label}
                    label={row.label}
                    value={row.value}
                    tone={row.tone === "bad" ? "bad" : row.tone}
                  />
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                The deployment is only reported when it was actually loaded. This analysis inspects
                the repository and the submitted documents, so interaction tests, console errors and
                broken-link checks stay unmeasured instead of being guessed.
              </p>
            </ReportSection>

            {/* 06 · Performance */}
            <ReportSection
              value="performance"
              title="Performance"
              icon={<Gauge className="h-4 w-4" />}
            >
              <div className="grid gap-2 sm:grid-cols-2">
                {performance.map((metric) => {
                  const status = METRIC_STATUS[metric.status];
                  return (
                    <div
                      key={metric.name}
                      className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm text-muted-foreground">{metric.name}</span>
                        <span
                          className={`font-mono text-sm tabular-nums ${metric.value === null ? "text-muted-foreground" : "font-semibold"}`}
                        >
                          {metric.value ?? "Not measured"}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                        <span className="text-muted-foreground">Target {metric.target ?? "—"}</span>
                        <span className={`flex items-center gap-1.5 ${status.className}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                          {status.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {measuredMetrics.length === 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  No runtime metric was measured for this submission — the numbers above are not
                  estimates, they are gaps.
                </p>
              )}
              {view.performance.vitals.length > 0 && (
                <div className="mt-4">
                  <Suspense
                    fallback={
                      <div className="h-[180px] w-full animate-pulse rounded-lg bg-muted/40" />
                    }
                  >
                    <PerformanceChart
                      vitals={view.performance.vitals.map((vital) => ({
                        name: vital.name,
                        value: vital.value ?? null,
                        threshold: vital.threshold ?? null,
                      }))}
                    />
                  </Suspense>
                </div>
              )}
            </ReportSection>

            {/* 07 · Security */}
            <ReportSection
              value="security"
              title="Security"
              icon={<ShieldCheck className="h-4 w-4" />}
              count={security.issues.length}
              tone={
                security.issues.some((issue) => issue.severity === "critical")
                  ? "destructive"
                  : "warning"
              }
            >
              {security.summary && (
                <p className="text-sm text-muted-foreground">{security.summary}</p>
              )}
              {security.issues.length === 0 ? (
                <div className="mt-3">
                  <EmptyNote>
                    No exposed credentials or unsafe configuration were detected in the repository.
                  </EmptyNote>
                </div>
              ) : (
                <ul className="mt-4 space-y-3">
                  {security.issues.map((issue, index) => (
                    <li
                      key={`${issue.title}-${index}`}
                      className="rounded-lg border border-border/70 bg-card/40 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className={`text-[11px] uppercase ${SEVERITY_BADGE[issue.severity]}`}
                        >
                          {issue.severity}
                        </Badge>
                        <span className="text-sm font-medium">{issue.title}</span>
                      </div>
                      <dl className="mt-2 space-y-1 text-xs">
                        {issue.evidence && (
                          <div className="flex gap-3">
                            <dt className="w-28 shrink-0 text-muted-foreground">Evidence</dt>
                            <dd className="text-foreground/90">{issue.evidence}</dd>
                          </div>
                        )}
                        <div className="flex gap-3">
                          <dt className="w-28 shrink-0 text-muted-foreground">Why it matters</dt>
                          <dd className="text-foreground/90">{issue.impact}</dd>
                        </div>
                        {issue.fix && (
                          <div className="flex gap-3">
                            <dt className="w-28 shrink-0 text-muted-foreground">Fix</dt>
                            <dd className="text-foreground/90">{issue.fix}</dd>
                          </div>
                        )}
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
            </ReportSection>

            {/* 08 · Code quality */}
            <ReportSection value="code" title="Code quality" icon={<Layers className="h-4 w-4" />}>
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="font-mono text-2xl font-semibold tabular-nums">
                  {codeQuality.score ?? "—"}
                  <span className="text-sm font-normal text-muted-foreground">/100</span>
                </span>
                {codeQuality.coveragePct !== null && (
                  <Badge variant="outline" className="text-xs">
                    Coverage · {codeQuality.coveragePct}%
                  </Badge>
                )}
                {view.evidence?.testFiles != null && (
                  <Badge variant="outline" className="text-xs">
                    {view.evidence.testFiles} test file{view.evidence.testFiles === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
              {codeQuality.summary && (
                <p className="mt-3 text-sm text-muted-foreground">{codeQuality.summary}</p>
              )}
              {codeQuality.stack.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Stack
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {codeQuality.stack.map((name) => (
                      <Badge key={name} variant="secondary" className="text-xs">
                        {name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Testing
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {codeQuality.testing ?? "No testing evidence was recorded."}
                  </p>
                  {codeQuality.testingNotes.length > 0 && (
                    <div className="mt-2">
                      <BulletList items={codeQuality.testingNotes} />
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Maintainability
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {codeQuality.maintainability ?? "No maintainability evidence was recorded."}
                  </p>
                  {codeQuality.maintainabilityNotes.length > 0 && (
                    <div className="mt-2">
                      <BulletList items={codeQuality.maintainabilityNotes} />
                    </div>
                  )}
                </div>
              </div>
              {codeQuality.findings.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    What was found
                  </p>
                  <div className="mt-2">
                    <BulletList items={codeQuality.findings} icon="check" />
                  </div>
                </div>
              )}
              {view.architecture.layers.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Structure
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    {view.architecture.layers.map((layer) => (
                      <li key={layer.name}>
                        <span className="text-foreground">{layer.name}</span>
                        {layer.detail ? ` · ${layer.detail}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </ReportSection>

            {/* 09 · Documentation */}
            <ReportSection
              value="documentation"
              title="Documentation"
              icon={<FileText className="h-4 w-4" />}
            >
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-2xl font-semibold tabular-nums">
                  {documentation.score ?? "—"}
                  <span className="text-sm font-normal text-muted-foreground">/100</span>
                </span>
              </div>
              <ul className="mt-3 space-y-2">
                {documentation.rows.map((row) => {
                  const state = DOC_STATE[row.state];
                  return (
                    <li key={row.label} className="flex items-start gap-2 text-sm">
                      <span className={`mt-0.5 w-4 shrink-0 ${state.className}`} aria-hidden>
                        {state.glyph}
                      </span>
                      <span className="min-w-0">
                        <span className="text-foreground">{row.label}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {row.state === "present"
                            ? "documented"
                            : row.state === "missing"
                              ? "missing"
                              : "partially documented"}
                        </span>
                        {row.note && (
                          <span className="block text-xs text-muted-foreground">{row.note}</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {documentation.notes.length > 0 && (
                <div className="mt-4">
                  <BulletList items={documentation.notes} />
                </div>
              )}
              {view.documentation.summary && (
                <p className="mt-3 text-xs text-muted-foreground">{view.documentation.summary}</p>
              )}
            </ReportSection>

            {/* 10 · Evidence sources */}
            <ReportSection
              value="evidence"
              title="Evidence sources"
              icon={<FileCheck2 className="h-4 w-4" />}
              count={insights.evidenceSources.filter((source) => source.available === true).length}
            >
              <ul className="space-y-3">
                {insights.evidenceSources.map((source) => {
                  const glyph =
                    source.available === true ? "✓" : source.available === false ? "✕" : "—";
                  const className =
                    source.available === true
                      ? "text-success"
                      : source.available === false
                        ? "text-destructive"
                        : "text-muted-foreground";
                  return (
                    <li key={source.key} className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 w-4 shrink-0 font-semibold ${className}`}
                        aria-hidden
                      >
                        {glyph}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{source.label}</p>
                        <p className="text-xs text-muted-foreground">{source.detail}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {view.documentAnalysis && (
                <div className="mt-4 space-y-2 border-t border-border/60 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Document extraction
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {view.documentAnalysis.fileName ?? "Submitted document"}
                    {view.documentAnalysis.totalPages !== null &&
                      ` · ${view.documentAnalysis.totalPages} ${view.documentAnalysis.fileType === "pptx" ? "slides" : "pages"}`}
                    {view.documentAnalysis.charsExtracted !== null &&
                      ` · ${view.documentAnalysis.charsExtracted.toLocaleString()} characters`}
                    {view.documentAnalysis.ocrApplied ? " · read via OCR" : ""}
                  </p>
                  {view.documentAnalysis.error && (
                    <p className="text-xs text-destructive">{view.documentAnalysis.error}</p>
                  )}
                  {view.documentAnalysis.warnings.length > 0 && (
                    <ul className="space-y-1">
                      {view.documentAnalysis.warnings.map((warning) => (
                        <li key={warning} className="text-xs text-warning">
                          {warning}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {view.documentAnalysis.disclaimer ??
                      "Claims from the submitted document are the team's own assertions, not verified facts."}
                  </p>
                </div>
              )}
            </ReportSection>

            {/* 11 · Pipeline (how the verdict was produced) */}
            <ReportSection
              value="pipeline"
              title="Evaluation pipeline"
              icon={<TrendingUp className="h-4 w-4" />}
            >
              <EvaluationPipeline stages={pipelineStages} />
              {view.analysis && view.analysis.limitations.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    What this analysis could not do
                  </p>
                  <ul className="mt-2 space-y-1">
                    {view.analysis.limitations.map((limitation) => (
                      <li key={limitation} className="flex gap-2 text-xs text-muted-foreground">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{limitation}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </ReportSection>
          </Accordion>
        </div>

        {/* ── 11. RECOMMENDATIONS ────────────────────────────────────────── */}
        <section className="surface p-6">
          <SectionHeading index="04" title="Recommendations" hint="Highest priority first" />
          {insights.recommendations.length === 0 ? (
            <div className="mt-3">
              <EmptyNote>No recommendations were recorded for this report.</EmptyNote>
            </div>
          ) : (
            <ol className="mt-3 space-y-3">
              {insights.recommendations.map((recommendation, index) => (
                <li key={`${recommendation.title}-${index}`} className="flex gap-3">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-muted font-mono text-xs text-muted-foreground">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-[11px] font-semibold uppercase tracking-wide ${
                          recommendation.priority === "critical"
                            ? "text-destructive"
                            : recommendation.priority === "high"
                              ? "text-warning"
                              : "text-muted-foreground"
                        }`}
                      >
                        {recommendation.priority}
                      </span>
                      <span className="text-sm font-medium">{recommendation.title}</span>
                    </div>
                    {recommendation.detail && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {recommendation.detail}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* ── 12. FINAL VERDICT ──────────────────────────────────────────── */}
        <section className="surface p-6">
          <SectionHeading index="05" title="Final verdict" hint={`${overall ?? "—"}/100`} />
          <div className="mt-3 grid gap-6 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-success">
                Strong points
              </p>
              {insights.finalVerdict.strong.length > 0 ? (
                <div className="mt-2">
                  <BulletList items={insights.finalVerdict.strong} icon="check" />
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">None recorded.</p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-destructive">
                Main concerns
              </p>
              {insights.finalVerdict.concerns.length > 0 ? (
                <div className="mt-2">
                  <BulletList items={insights.finalVerdict.concerns} icon="cross" />
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">None recorded.</p>
              )}
            </div>
          </div>
          <p className="mt-5 border-l-2 border-primary/50 pl-4 text-sm italic text-foreground/90">
            “{insights.finalVerdict.takeaway}”
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            Every number in this report comes from evidence that was read: the submitted documents,
            the repository listing and, when present, measurements of the deployed site. Nothing
            here is an AI estimate.
          </p>
        </section>
      </div>
    </AppLayout>
  );
}
