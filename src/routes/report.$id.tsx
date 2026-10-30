import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState, useMemo, lazy, Suspense, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Check,
  ChevronDown,
  CircuitBoard,
  ClipboardCheck,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  FileWarning,
  Gauge,
  Gavel,
  GitBranch,
  Github,
  Globe,
  Info,
  Layers,
  Lightbulb,
  ListChecks,
  Loader2,
  MessagesSquare,
  Plus,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Wrench,
  XCircle,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import { Accordion } from "@radix-ui/react-accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { AppLayout } from "@/components/layout/AppLayout";
import { BrandMark } from "@/components/brand/BrandLogo";
import { ScoreRing, scoreTone } from "@/components/ScoreRing";
import { ReportSection } from "@/components/report/ReportSection";
import { ErrorState } from "@/components/state/ErrorState";
import {
  AmbientCard,
  EvaluationPipeline,
  LoadingState,
  StaggerContainer,
  StaggerItem,
  type PipelineStage,
} from "@/components/motion/primitives";
import { PerformanceChart, RepositoryChart } from "@/components/Charts";
import { getReportSummary, getReport, type ReportSummary } from "@/services/report.service";
import { getGuestReport, type GuestReport } from "@/services/guest.service";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  normalizeReportData,
  normalizeReportStatus,
  type Claim,
  type DocumentClaimsView,
  type ReportView,
  type RiskSeverity,
} from "@/lib/report-data";
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
import { AiVerdictPanel, deriveVerdictFromReport } from "@/components/evaluation/AiVerdictPanel";

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
      // analyst payload is fetched on demand (see `loadReportData` below).
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

const listIcon = "mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary";

/** Verdict presentation for one registered claim. Honest vocabulary only. */
function claimVerdict(claim: Claim): {
  key: string;
  label: string;
  className: string;
  icon: ReactNode;
} {
  const status = claim.status ?? (claim.verified ? "supported" : "unverified");
  switch (status) {
    case "supported":
      return {
        key: status,
        label: "Supported",
        className: "border-success/30 bg-success/10 text-success",
        icon: <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />,
      };
    case "partial":
      return {
        key: status,
        label: "Partial",
        className: "border-warning/30 bg-warning/10 text-warning",
        icon: <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />,
      };
    case "unsupported":
      return {
        key: status,
        label: "Not supported",
        className: "border-destructive/30 bg-destructive/10 text-destructive",
        icon: <XCircle className="h-4 w-4 shrink-0 text-destructive" />,
      };
    case "could_not_verify":
      return {
        key: status,
        label: "Could not verify",
        className: "border-border bg-muted/40 text-muted-foreground",
        icon: <Info className="h-4 w-4 shrink-0 text-muted-foreground" />,
      };
    default:
      return {
        key: status,
        label: "Unverified",
        className: "border-border bg-muted/40 text-muted-foreground",
        icon: <Info className="h-4 w-4 shrink-0 text-muted-foreground" />,
      };
  }
}

/** `PPT — Slide 6 · README` — every source the claim was found in. */
function claimSourceLabel(claim: Claim): string | null {
  if (claim.sources && claim.sources.length > 0) {
    return claim.sources
      .map((source) => (source.location ? `${source.source} — ${source.location}` : source.source))
      .join(" · ");
  }
  if (!claim.source) return null;
  return claim.sourceLocation ? `${claim.source} — ${claim.sourceLocation}` : claim.source;
}

/** One expandable claim row: verdict up top, evidence and reason when opened. */
function ClaimRow({ claim }: { claim: Claim }) {
  const verdict = claimVerdict(claim);
  const source = claimSourceLabel(claim);
  return (
    <li>
      <details className="group rounded-lg border border-border/70 bg-card/40 px-3 py-2.5">
        <summary className="flex cursor-pointer list-none items-start gap-3 [&::-webkit-details-marker]:hidden">
          {verdict.icon}
          <span className="min-w-0 flex-1 text-sm font-medium leading-snug">{claim.claim}</span>
          <Badge variant="outline" className={`shrink-0 text-[11px] ${verdict.className}`}>
            {verdict.label}
          </Badge>
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <dl className="mt-2 space-y-1.5 border-t border-border/60 pt-2 text-xs">
          {source && (
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-muted-foreground">Source</dt>
              <dd className="text-foreground/90">{source}</dd>
            </div>
          )}
          {claim.evidence && (
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-muted-foreground">Evidence</dt>
              <dd className="text-foreground/90">{claim.evidence}</dd>
            </div>
          )}
          {claim.reason && (
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-muted-foreground">Reason</dt>
              <dd className="text-foreground/90">{claim.reason}</dd>
            </div>
          )}
        </dl>
      </details>
    </li>
  );
}

/** Sections the page opens by default. */
const DEFAULT_OPEN_SECTIONS = ["verdict", "summary", "overview", "risks", "recommendations"];

/** Every report section, expanded for printing so nothing is cut off. */
const ALL_SECTIONS = [
  "verdict",
  "summary",
  "overview",
  "architecture",
  "code",
  "security",
  "performance",
  "maintainability",
  "documentation",
  "testing",
  "risks",
  "recommendations",
  "scores",
  "repo",
  "website",
  "document",
  "claims",
  "innovation",
  "interview",
  "judge",
  "timeline",
];

function BulletList({ items, icon }: { items: string[]; icon?: "check" | "cross" }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item, k) => (
        <motion.li
          key={`${item}-${k}`}
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: k * 0.04 }}
          className="flex gap-2.5 text-sm text-muted-foreground"
        >
          {icon === "check" ? (
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          ) : icon === "cross" ? (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          ) : (
            <span className={listIcon} />
          )}
          {item}
        </motion.li>
      ))}
    </ul>
  );
}

function EmptyNote({ children }: { children?: string }) {
  return (
    <p className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
      {children ?? "No data was captured for this section yet."}
    </p>
  );
}

function ScoreStat({ label, score }: { label: string; score: number | null }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4">
      <p className="text-xs capitalize text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          score === null ? "text-muted-foreground" : scoreTone(score)
        }`}
      >
        {score ?? "—"}
      </p>
      <Progress value={score ?? 0} className="mt-2 h-1" aria-label={`${label} score`} />
    </div>
  );
}

const severityClass: Record<RiskSeverity, string> = {
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  high: "border-destructive/30 bg-destructive/10 text-destructive",
  medium: "border-warning/30 bg-warning/10 text-warning",
  low: "border-border bg-muted/50 text-muted-foreground",
  unknown: "border-border bg-muted/50 text-muted-foreground",
};

function SeverityBadge({ severity }: { severity: RiskSeverity }) {
  return (
    <Badge variant="outline" className={`text-xs capitalize ${severityClass[severity]}`}>
      {severity}
    </Badge>
  );
}

function scoreBand(score: number | null): { label: string; className: string } {
  if (score === null) return { label: "Not scored yet", className: "text-muted-foreground" };
  if (score >= 85) return { label: "Excellent", className: "text-success" };
  if (score >= 70) return { label: "Strong submission", className: "text-success" };
  if (score >= 55) return { label: "Needs improvement", className: "text-warning" };
  return { label: "Significant gaps", className: "text-destructive" };
}

function scoreDimensions(view: ReportView): { label: string; score: number | null }[] {
  return [
    { label: "Overall", score: view.scores.overall },
    { label: "Evidence", score: view.scores.evidence },
    { label: "Code quality", score: view.scores.codeQuality },
    { label: "Security", score: view.scores.security },
    { label: "Performance", score: view.scores.performance },
    { label: "Maintainability", score: view.scores.maintainability },
    { label: "Testing", score: view.scores.testing },
    { label: "Documentation", score: view.scores.documentation },
    { label: "Innovation", score: view.scores.innovation },
  ];
}

/** Claim categories extracted from the submitted document, in display order. */
const DOCUMENT_CLAIM_GROUPS: {
  key: Exclude<keyof DocumentClaimsView, "summary" | "method">;
  label: string;
}[] = [
  { key: "problem", label: "Problem being solved" },
  { key: "solution", label: "Proposed solution" },
  { key: "features", label: "Key features" },
  { key: "technology", label: "Technology / AI used" },
  { key: "impact", label: "Claimed impact & results" },
];

function documentStatusBadge(status: string | null): { label: string; className: string } {
  if (status === "success") {
    return { label: "Text extracted", className: "border-success/30 bg-success/10 text-success" };
  }
  if (status === "partial") {
    return { label: "Partially read", className: "border-warning/30 bg-warning/10 text-warning" };
  }
  if (status === "failed") {
    return {
      label: "Could not be read",
      className: "border-destructive/30 bg-destructive/10 text-destructive",
    };
  }
  return { label: "Not analysed", className: "border-border bg-muted/50 text-muted-foreground" };
}

function ReportState({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <AppLayout title={title} subtitle={subtitle} crumbs={[{ label: "Reports", to: "/reports" }]}>
      <div className="mx-auto max-w-lg py-10">{children}</div>
    </AppLayout>
  );
}

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

  // The loader returns a summary (fast, no report_data). The full analyst
  // payload is fetched lazily after first paint so the UI can show the shell
  // immediately and only render the detailed sections once the data arrives.
  const [reportData, setReportData] = useState<ReportView | null>(null);
  const [fullRow, setFullRow] = useState<ReportRow | null>(null);
  // A summary row means the payload fetch is about to start — render skeletons
  // from the first paint instead of flashing empty sections.
  const [dataLoading, setDataLoading] = useState(loaderRow !== null);

  // Prefer the full row (loaded lazily) so the detailed view has the real
  // report_data payload. The summary (id, name, status, score, dates) is still
  // available immediately for the shell.
  const reportRow: ReportSummary | ReportRow | GuestReport | null =
    fullRow ?? loaderRow ?? guestRow;

  const status = normalizeReportStatus(reportRow?.status);
  const view = reportData ?? normalizeReportData(reportDataOf(reportRow));
  const aiVerdict = useMemo(() => deriveVerdictFromReport(view), [view]);

  // Fetch the full report (with report_data) after the summary shell renders.
  // Guest rows already carry their payload, so only summary rows hit the network.
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

  /**
   * Export the report as a standalone, printable HTML document.
   *
   * Uses only the already-normalised report data, so a malformed or empty
   * payload produces a document that says the section is empty — never invented
   * findings — and a failure here cannot crash the page.
   */
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
    view.scores.overall ??
    (typeof reportRow.score === "number" && Number.isFinite(reportRow.score)
      ? Math.round(reportRow.score)
      : null);
  const band = scoreBand(overall);
  const verifiedClaims = view.claims.filter((c) => c.verified).length;
  const claimCounts = view.claimCounts;
  const claimPipeline = view.claimPipeline;
  const claimsRegistered = claimCounts.total > 0;
  const dimensions = scoreDimensions({ ...view, scores: { ...view.scores, overall } });
  const scoredDimensions = dimensions.filter((d) => d.score !== null);
  const findings = view.risks.length > 0 ? view.risks : view.security.findings;

  // Pipeline states come from what the report actually contains — never faked.
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
        ? `${view.documentAnalysis.fileName ?? "Submitted document"} read — ${claimPipeline?.deck ?? view.claims.filter((c) => c.source === "PPT" || c.source === "PDF").length} claims from it`
        : "No document was attached to this submission",
      state: view.documentAnalysis
        ? "done"
        : view.hasPayloadData
          ? "done"
          : running
            ? "active"
            : "pending",
    },
    {
      label: "Claims extracted",
      icon: <ClipboardCheck className="h-3.5 w-3.5" />,
      detail: claimPipeline
        ? `${claimPipeline.extracted} extracted (${claimPipeline.deck} deck + ${claimPipeline.readme} README) · ${claimPipeline.deduped} merged`
        : `${claimCounts.total} registered claims`,
      state: claimStageState(claimPipeline ? claimPipeline.extracted > 0 : claimsRegistered),
    },
    {
      label: "Claims verified",
      icon: <ListChecks className="h-3.5 w-3.5" />,
      detail: claimPipeline
        ? `${claimPipeline.verified} of ${claimPipeline.registered} claims decided against the evidence`
        : `${verifiedClaims} of ${claimCounts.total} verified`,
      state: claimStageState(claimPipeline ? claimPipeline.verified > 0 : verifiedClaims > 0),
    },
    {
      label: "Repository analyzed",
      icon: <Github className="h-3.5 w-3.5" />,
      state:
        view.repository || view.architecture.stack.length > 0
          ? "done"
          : running
            ? "active"
            : "pending",
    },
    {
      label: "Project evaluated",
      icon: <ListChecks className="h-3.5 w-3.5" />,
      state: view.hasPayloadData ? "done" : running ? "active" : "pending",
    },
    {
      label: "AI scoring",
      icon: <TrendingUp className="h-3.5 w-3.5" />,
      state: scoredDimensions.length > 0 ? "done" : running ? "active" : "pending",
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
      <div className="space-y-5">
        {/* Status + data-source banner */}
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
                {view.hasPayloadData ? "Live report data" : "Awaiting analysis data"}
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
          {status.kind === "in_progress" ? (
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

        {/* Hero score cards */}
        <StaggerContainer className="grid gap-5 lg:grid-cols-3">
          <StaggerItem>
            <AmbientCard className="surface flex h-full items-center gap-6 p-6">
              <ScoreRing value={overall} label="/ 100" />
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">Overall Score</p>
                <p className={`mt-1 text-lg font-semibold ${band.className}`}>{band.label}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {overall === null
                    ? "No score stored for this report."
                    : `Stored score · ${status.kind === "completed" ? "final" : "not final"}`}
                </p>
              </div>
            </AmbientCard>
          </StaggerItem>
          <StaggerItem>
            <AmbientCard className="surface flex h-full items-center gap-6 p-6">
              <ScoreRing value={view.scores.evidence} label="/ 100" />
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">Claim verification</p>
                {claimPipeline?.error ? (
                  <>
                    <p className="mt-1 text-lg font-semibold text-destructive">Pipeline error</p>
                    <p className="mt-2 text-xs text-destructive">{claimPipeline.error}</p>
                  </>
                ) : claimsRegistered ? (
                  <>
                    <p className="mt-1 text-lg font-semibold">
                      {claimCounts.total} claim{claimCounts.total === 1 ? "" : "s"} analyzed
                    </p>
                    <ul className="mt-2 space-y-0.5 text-xs">
                      <li className="text-success">✓ {claimCounts.supported} supported</li>
                      <li className="text-warning">⚠ {claimCounts.partial} partially supported</li>
                      <li className="text-destructive">
                        ✕ {claimCounts.unsupported} not supported
                      </li>
                      {claimCounts.could_not_verify > 0 && (
                        <li className="text-muted-foreground">
                          ? {claimCounts.could_not_verify} could not be verified
                        </li>
                      )}
                    </ul>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Full table in Claim Verification — each claim opens to its evidence.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-lg font-semibold">No claims extracted</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      The submitted materials contained no readable claims (no deck text and no
                      README assertions), so there was nothing to verify.
                    </p>
                  </>
                )}
              </div>
            </AmbientCard>
          </StaggerItem>
          <StaggerItem>
            <AmbientCard className="surface space-y-4 p-6">
              {view.metrics.length > 0 ? (
                view.metrics.map((m) => (
                  <div key={m.label}>
                    <div className="mb-1.5 flex justify-between text-sm">
                      <span>{m.label}</span>
                      <span
                        className={`font-mono ${m.score === null ? "text-muted-foreground" : scoreTone(m.score)}`}
                      >
                        {m.score ?? "—"}
                      </span>
                    </div>
                    <Progress value={m.score ?? 0} className="h-1.5" />
                  </div>
                ))
              ) : (
                <EmptyNote>No per-metric scores were stored with this report.</EmptyNote>
              )}
            </AmbientCard>
          </StaggerItem>
        </StaggerContainer>

        {/* Evidence pipeline */}
        <EvaluationPipeline stages={pipelineStages} />

        {/* Collapsible sections */}
        {dataLoading && !view.hasPayloadData ? (
          <div className="surface p-6">
            <LoadingState label="Loading report analysis…" rows={6} />
          </div>
        ) : (
          <Accordion
            type="multiple"
            value={openSections}
            onValueChange={setOpenSections}
            className="surface px-6"
          >
            <ReportSection
              value="verdict"
              title="AI Verdict"
              icon={<Bot className="h-4 w-4" />}
              defaultOpen
            >
              <AiVerdictPanel verdict={aiVerdict} title="AI Analysis &amp; Pre-Assessment" />
            </ReportSection>

            <ReportSection
              value="summary"
              title="Executive Summary"
              icon={<FileText className="h-4 w-4" />}
              defaultOpen
            >
              {view.executiveSummary ? (
                <p className="text-sm text-muted-foreground">{view.executiveSummary}</p>
              ) : (
                <EmptyNote />
              )}
            </ReportSection>

            <ReportSection
              value="overview"
              title="Project Overview"
              icon={<Info className="h-4 w-4" />}
              defaultOpen
            >
              {view.overview.summary ? (
                <p className="text-sm text-muted-foreground">{view.overview.summary}</p>
              ) : (
                <EmptyNote>No overview summary was stored with this report.</EmptyNote>
              )}
              {(view.overview.repoUrl || view.overview.websiteUrl) && (
                <div className="mt-4 flex flex-wrap gap-4 text-sm">
                  {view.overview.repoUrl && (
                    <a
                      href={view.overview.repoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-primary hover:underline"
                    >
                      <Github className="h-4 w-4" /> {view.overview.repoUrl}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {view.overview.websiteUrl && (
                    <a
                      href={view.overview.websiteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-primary hover:underline"
                    >
                      <Globe className="h-4 w-4" /> {view.overview.websiteUrl}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              )}
              {view.overview.highlights.length > 0 && (
                <div className="mt-5">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Highlights
                  </p>
                  <BulletList items={view.overview.highlights} icon="check" />
                </div>
              )}
            </ReportSection>

            <ReportSection
              value="architecture"
              title="Architecture / Technology Stack"
              icon={<Layers className="h-4 w-4" />}
              count={view.architecture.stack.length || undefined}
            >
              {view.architecture.summary && (
                <p className="text-sm text-muted-foreground">{view.architecture.summary}</p>
              )}
              {view.architecture.stack.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {view.architecture.stack.map((entry) => (
                    <Badge
                      key={entry.name}
                      variant="secondary"
                      className="text-xs"
                      title={entry.detail ?? undefined}
                    >
                      {entry.name}
                      {entry.detail ? ` · ${entry.detail}` : ""}
                    </Badge>
                  ))}
                </div>
              ) : (
                !view.architecture.summary && <EmptyNote />
              )}
              {view.architecture.layers.length > 0 && (
                <div className="mt-5 space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Layers
                  </p>
                  <ul className="space-y-2">
                    {view.architecture.layers.map((layer) => (
                      <li key={layer.name} className="text-sm text-muted-foreground">
                        <strong className="text-foreground">{layer.name}:</strong>{" "}
                        {layer.detail ?? "—"}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {view.architecture.decisions.length > 0 && (
                <div className="mt-5">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Key decisions
                  </p>
                  <BulletList items={view.architecture.decisions} />
                </div>
              )}
            </ReportSection>

            <ReportSection
              value="code"
              title="Code Quality"
              icon={<ClipboardCheck className="h-4 w-4" />}
              count={view.codeQuality.findings.length || undefined}
            >
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-3xl font-semibold tabular-nums ${
                      view.scores.codeQuality === null
                        ? "text-muted-foreground"
                        : scoreTone(view.scores.codeQuality)
                    }`}
                  >
                    {view.scores.codeQuality ?? "—"}
                  </span>
                  <span className="text-sm text-muted-foreground">/ 100</span>
                </div>
                {view.codeQuality.coveragePct !== null && (
                  <Badge variant="outline" className="text-xs">
                    Test coverage · {view.codeQuality.coveragePct}%
                  </Badge>
                )}
              </div>
              {view.codeQuality.summary && (
                <p className="mt-3 text-sm text-muted-foreground">{view.codeQuality.summary}</p>
              )}
              {view.codeQuality.findings.length > 0 ? (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Findings
                  </p>
                  <BulletList items={view.codeQuality.findings} icon="check" />
                </div>
              ) : view.codeQuality.notes.length > 0 ? (
                <div className="mt-4">
                  <BulletList items={view.codeQuality.notes} icon="check" />
                </div>
              ) : (
                !view.codeQuality.summary && <EmptyNote />
              )}
            </ReportSection>

            <ReportSection
              value="security"
              title="Security"
              icon={<ShieldCheck className="h-4 w-4" />}
              count={view.security.findings.length || undefined}
              tone="warning"
            >
              {view.security.summary && (
                <p className="text-sm text-muted-foreground">{view.security.summary}</p>
              )}
              {view.security.findings.length > 0 ? (
                <ul className="mt-4 space-y-3">
                  {view.security.findings.map((finding, i) => (
                    <li key={`${finding.title}-${i}`} className="flex gap-3">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 font-medium">
                          {finding.title}
                          <SeverityBadge severity={finding.severity} />
                        </div>
                        {finding.detail && (
                          <p className="text-sm text-muted-foreground">{finding.detail}</p>
                        )}
                        {finding.mitigation && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Fix: {finding.mitigation}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                !view.security.summary && <EmptyNote />
              )}
            </ReportSection>

            <ReportSection
              value="performance"
              title="Performance"
              icon={<Gauge className="h-4 w-4" />}
            >
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-3xl font-semibold tabular-nums ${
                      view.scores.performance === null
                        ? "text-muted-foreground"
                        : scoreTone(view.scores.performance)
                    }`}
                  >
                    {view.scores.performance ?? "—"}
                  </span>
                  <span className="text-sm text-muted-foreground">/ 100</span>
                </div>
                {view.performance.pageWeightMb !== null && (
                  <Badge variant="outline" className="text-xs">
                    Page weight · {view.performance.pageWeightMb} MB
                  </Badge>
                )}
              </div>
              {view.performance.summary && (
                <p className="mt-3 text-sm text-muted-foreground">{view.performance.summary}</p>
              )}
              {view.performance.lighthouse.some((entry) => entry.score !== null) && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {view.performance.lighthouse.map((entry) => (
                    <ScoreStat key={entry.name} label={entry.name} score={entry.score} />
                  ))}
                </div>
              )}
              {view.performance.vitals.length > 0 && (
                <>
                  <div className="mt-4 flex flex-wrap gap-6 text-sm text-muted-foreground">
                    {view.performance.vitals.map((vital) => (
                      <span key={vital.name}>
                        {vital.name} {vital.value ?? "—"}
                        {vital.unit}
                      </span>
                    ))}
                  </div>
                  <div className="mt-4">
                    <Suspense
                      fallback={
                        <div className="h-[180px] w-full animate-pulse rounded-lg bg-muted/40" />
                      }
                    >
                      <PerformanceChart
                        vitals={view.performance.vitals.map((v) => ({
                          name: v.name,
                          value: v.value ?? null,
                          threshold: v.threshold ?? null,
                        }))}
                      />
                    </Suspense>
                  </div>
                </>
              )}
              {view.performance.summary === null &&
                view.performance.vitals.length === 0 &&
                !view.performance.lighthouse.some((entry) => entry.score !== null) && <EmptyNote />}
            </ReportSection>

            <ReportSection
              value="maintainability"
              title="Maintainability"
              icon={<Wrench className="h-4 w-4" />}
            >
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-3xl font-semibold tabular-nums ${
                    view.scores.maintainability === null
                      ? "text-muted-foreground"
                      : scoreTone(view.scores.maintainability)
                  }`}
                >
                  {view.scores.maintainability ?? "—"}
                </span>
                <span className="text-sm text-muted-foreground">/ 100</span>
              </div>
              {view.maintainability.summary ? (
                <p className="mt-3 text-sm text-muted-foreground">{view.maintainability.summary}</p>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  No maintainability summary was stored with this report.
                </p>
              )}
              {view.maintainability.notes.length > 0 && (
                <div className="mt-4">
                  <BulletList items={view.maintainability.notes} />
                </div>
              )}
            </ReportSection>

            <ReportSection
              value="documentation"
              title="Documentation"
              icon={<FileWarning className="h-4 w-4" />}
            >
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-3xl font-semibold tabular-nums ${
                    view.scores.documentation === null
                      ? "text-muted-foreground"
                      : scoreTone(view.scores.documentation)
                  }`}
                >
                  {view.scores.documentation ?? "—"}
                </span>
                <span className="text-sm text-muted-foreground">/ 100</span>
              </div>
              {view.documentation.summary ? (
                <p className="mt-3 text-sm text-muted-foreground">{view.documentation.summary}</p>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  No documentation evidence was recorded — not enough evidence.
                </p>
              )}
              {view.documentation.notes.length > 0 && (
                <div className="mt-4">
                  <BulletList items={view.documentation.notes} />
                </div>
              )}
            </ReportSection>

            <ReportSection
              value="testing"
              title="Testing"
              icon={<ListChecks className="h-4 w-4" />}
              tone="warning"
            >
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-3xl font-semibold tabular-nums ${
                    view.scores.testing === null
                      ? "text-muted-foreground"
                      : scoreTone(view.scores.testing)
                  }`}
                >
                  {view.scores.testing ?? "—"}
                </span>
                <span className="text-sm text-muted-foreground">/ 100</span>
              </div>
              {view.testing.summary ? (
                <p className="mt-3 text-sm text-muted-foreground">{view.testing.summary}</p>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  No testing evidence was recorded — not enough evidence.
                </p>
              )}
              {view.testing.notes.length > 0 && (
                <div className="mt-4">
                  <BulletList items={view.testing.notes} />
                </div>
              )}
            </ReportSection>

            <ReportSection
              value="risks"
              title="Risks / Findings"
              icon={<FileWarning className="h-4 w-4" />}
              count={findings.length || undefined}
              tone="destructive"
              defaultOpen
            >
              {findings.length > 0 ? (
                <ul className="space-y-4">
                  {findings.map((finding, i) => (
                    <li key={`${finding.title}-${i}`} className="flex gap-3">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 font-medium">
                          {finding.title}
                          <SeverityBadge severity={finding.severity} />
                        </div>
                        {finding.detail && (
                          <p className="text-sm text-muted-foreground">{finding.detail}</p>
                        )}
                        {finding.mitigation && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Mitigation: {finding.mitigation}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyNote>No risks or findings were recorded for this report.</EmptyNote>
              )}
            </ReportSection>

            <ReportSection
              value="recommendations"
              title="Recommendations"
              icon={<Lightbulb className="h-4 w-4" />}
              count={view.recommendations.length || undefined}
              tone="warning"
              defaultOpen
            >
              {view.recommendations.length > 0 ? (
                <ol className="space-y-3">
                  {view.recommendations.map((rec, i) => (
                    <motion.li
                      key={`${rec.title}-${i}`}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="flex gap-3 text-sm"
                    >
                      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 font-mono text-xs text-primary">
                        {i + 1}
                      </span>
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-foreground">
                          {rec.title}
                          {rec.priority && (
                            <Badge variant="outline" className="text-xs capitalize">
                              {rec.priority}
                            </Badge>
                          )}
                        </div>
                        {rec.detail && (
                          <p className="text-sm text-muted-foreground">{rec.detail}</p>
                        )}
                      </div>
                    </motion.li>
                  ))}
                </ol>
              ) : (
                <EmptyNote>No recommendations were stored with this report.</EmptyNote>
              )}
            </ReportSection>

            <ReportSection
              value="scores"
              title="Overall Score"
              icon={<TrendingUp className="h-4 w-4" />}
              tone="success"
            >
              {" "}
              {scoredDimensions.length > 0 ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {dimensions.map((dimension) => (
                      <ScoreStat
                        key={dimension.label}
                        label={dimension.label}
                        score={dimension.score}
                      />
                    ))}
                  </div>
                  {view.scoreBreakdown && view.scoreBreakdown.dimensions.length > 0 && (
                    <div className="mt-5">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        How the overall score is calculated
                      </p>
                      <ul className="space-y-2">
                        {view.scoreBreakdown.dimensions.map((dimension) => (
                          <li
                            key={dimension.key}
                            className="flex flex-wrap items-baseline gap-2 text-sm text-muted-foreground"
                          >
                            <span className="font-medium text-foreground">{dimension.label}</span>
                            <span className="font-mono text-xs">
                              {dimension.score === null ? "—" : dimension.score}
                            </span>
                            <span className="text-xs">
                              weight {Math.round(dimension.weight * 100)}%
                            </span>
                            {dimension.contribution !== null && (
                              <span className="text-xs">
                                contributes {dimension.contribution} pts
                              </span>
                            )}
                            <span className="w-full text-xs">{dimension.rationale}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <EmptyNote>No scores have been stored for this report yet.</EmptyNote>
              )}
            </ReportSection>

            {/* Detail sections that only render when the payload carries data */}
            {view.repository && (
              <ReportSection
                value="repo"
                title="Repository"
                icon={<Github className="h-4 w-4" />}
                count={view.repository.contributors ?? undefined}
              >
                {view.repository.url && (
                  <a
                    href={view.repository.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    {view.repository.url} <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
                  {[
                    { label: "Stars", value: view.repository.stars },
                    { label: "Forks", value: view.repository.forks },
                    { label: "Commits", value: view.repository.commits },
                    { label: "Contributors", value: view.repository.contributors },
                    { label: "Open issues", value: view.repository.openIssues },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="rounded-lg bg-muted/50 px-3 py-2.5 text-center"
                    >
                      <p className="text-lg font-semibold tabular-nums">{stat.value ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{stat.label}</p>
                    </div>
                  ))}
                </div>
                {view.repository.languages.length > 0 && (
                  <div className="mt-5">
                    <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Language mix
                    </p>
                    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {view.repository.languages.map((language) => (
                        <li key={language.name} className="flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{
                              background: `hsl(${(language.name.length * 60) % 360} 70% 55%)`,
                            }}
                          />
                          {language.name}
                          {language.pct > 0 ? ` · ${language.pct}%` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {view.repository.commitActivity.length > 0 && (
                  <div className="mt-5">
                    <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Commit activity
                    </p>
                    <Suspense
                      fallback={
                        <div className="h-[140px] w-full animate-pulse rounded-lg bg-muted/40" />
                      }
                    >
                      <RepositoryChart commitActivity={view.repository.commitActivity} />
                    </Suspense>
                  </div>
                )}
                {view.repository.notes.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {view.repository.notes.map((note) => (
                      <li key={note} className="flex gap-2 text-sm text-muted-foreground">
                        <Check className="mt-0.5 h-4 w-4 text-success" /> {note}
                      </li>
                    ))}
                  </ul>
                )}
              </ReportSection>
            )}

            {view.website && (
              <ReportSection value="website" title="Website" icon={<Globe className="h-4 w-4" />}>
                {view.website.url && (
                  <a
                    href={view.website.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    {view.website.url} <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                {view.website.status && (
                  <Badge
                    variant="outline"
                    className="ml-3 border-success/30 bg-success/10 text-success"
                  >
                    {view.website.status}
                  </Badge>
                )}
                <div className="mt-4 flex flex-wrap gap-6 text-sm text-muted-foreground">
                  {view.website.vitals.map((vital) => (
                    <span key={vital.name}>
                      {vital.name} {vital.value ?? "—"}
                      {vital.unit}
                    </span>
                  ))}
                  {view.website.pageWeightMb !== null && (
                    <span>Page weight {view.website.pageWeightMb} MB</span>
                  )}
                </div>
              </ReportSection>
            )}

            {view.documentAnalysis && (
              <ReportSection
                value="document"
                title="Document Analysis"
                icon={<FileText className="h-4 w-4" />}
                count={view.documentAnalysis.totalPages ?? undefined}
                tone="warning"
              >
                <div className="space-y-4">
                  {/* Extraction status — did OCR/text extraction work? */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={documentStatusBadge(view.documentAnalysis.status).className}
                    >
                      {documentStatusBadge(view.documentAnalysis.status).label}
                    </Badge>
                    {view.documentAnalysis.method && (
                      <Badge
                        variant="outline"
                        className="border-border bg-muted/60 text-muted-foreground"
                      >
                        {view.documentAnalysis.method === "ocr" || view.documentAnalysis.ocrApplied
                          ? "Read via OCR"
                          : "Text extracted"}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {view.documentAnalysis.fileName ?? "Submitted document"}
                      {typeof view.documentAnalysis.totalPages === "number" &&
                        ` · ${view.documentAnalysis.totalPages} ${view.documentAnalysis.fileType === "pptx" ? "slides" : "pages"}`}
                      {typeof view.documentAnalysis.charsExtracted === "number" &&
                        view.documentAnalysis.charsExtracted > 0 &&
                        ` · ${view.documentAnalysis.charsExtracted.toLocaleString()} characters read`}
                    </span>
                  </div>

                  {view.documentAnalysis.status === "failed" ? (
                    <div className="space-y-2">
                      <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                        {view.documentAnalysis.error ??
                          "The submitted document could not be read, so no claims were extracted from it."}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        The document is still part of the submission and can be reviewed manually —
                        only the automatic text/claim extraction failed.
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* The disclaimer: these are CLAIMS, not verified facts. */}
                      <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm font-medium text-warning">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        {view.documentAnalysis.disclaimer ??
                          "Claims from the submitted document — these are the team's own assertions, not automatically verified facts."}
                      </p>

                      {view.documentAnalysis.claims?.summary && (
                        <div className="space-y-1">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            What the team claims this project does
                          </p>
                          <p className="text-sm text-foreground">
                            {view.documentAnalysis.claims.summary}
                          </p>
                        </div>
                      )}

                      {view.documentAnalysis.claims ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          {DOCUMENT_CLAIM_GROUPS.map(({ key, label }) => {
                            const items = view.documentAnalysis?.claims?.[key] ?? [];
                            return (
                              <div
                                key={key}
                                className="rounded-lg border border-border bg-muted/30 p-3"
                              >
                                <p className="text-xs font-semibold text-foreground">{label}</p>
                                {items.length === 0 ? (
                                  <p className="mt-1 text-xs italic text-muted-foreground">
                                    Not stated in the document
                                  </p>
                                ) : (
                                  <ul className="mt-1.5 space-y-1.5">
                                    {items.map((item, i) => (
                                      <li
                                        key={`${key}-${i}`}
                                        className="flex gap-2 text-sm text-muted-foreground"
                                      >
                                        <span className={listIcon} />
                                        {item}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <EmptyNote>
                          No claims could be extracted from the document (nothing readable was
                          found).
                        </EmptyNote>
                      )}

                      {view.documentAnalysis.warnings.length > 0 && (
                        <ul className="space-y-1">
                          {view.documentAnalysis.warnings.map((warning) => (
                            <li
                              key={warning}
                              className="flex items-start gap-2 text-sm text-warning"
                            >
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                              {warning}
                            </li>
                          ))}
                        </ul>
                      )}

                      <p className="text-sm text-muted-foreground">
                        These claims are handed to the evaluation pipeline, which checks them
                        against the repository and the deployed website — see Claim Verification for
                        the outcome.
                      </p>
                    </>
                  )}
                </div>
              </ReportSection>
            )}

            {(view.claims.length > 0 || claimPipeline?.error) && (
              <ReportSection
                value="claims"
                title="Claim Verification"
                icon={<ListChecks className="h-4 w-4" />}
                count={view.claims.length}
                tone="warning"
              >
                {claimPipeline?.error ? (
                  <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    <strong>Pipeline error:</strong> {claimPipeline.error}
                  </p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {claimCounts.total} claim{claimCounts.total === 1 ? "" : "s"} extracted from
                      the submitted document and the repository README, deduplicated and checked
                      against the inspected evidence: {claimCounts.supported} supported,{" "}
                      {claimCounts.partial} partially supported, {claimCounts.unsupported} not
                      supported, {claimCounts.could_not_verify} could not be verified. A statement
                      in the PPT or README is a claim, never proof.
                      {claimPipeline && claimPipeline.deduction !== 0 && (
                        <>
                          {" "}
                          This claim set moves the overall score by {claimPipeline.deduction} point
                          {Math.abs(claimPipeline.deduction) === 1 ? "" : "s"}.
                        </>
                      )}
                    </p>
                    <ul className="mt-4 space-y-2">
                      {view.claims.map((claim, i) => (
                        <ClaimRow key={`${claim.claim}-${i}`} claim={claim} />
                      ))}
                    </ul>
                  </>
                )}
              </ReportSection>
            )}

            {view.innovation && (
              <ReportSection
                value="innovation"
                title="Innovation"
                icon={<CircuitBoard className="h-4 w-4" />}
                tone="success"
              >
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-4xl font-semibold tabular-nums ${
                      view.innovation.score === null
                        ? "text-muted-foreground"
                        : scoreTone(view.innovation.score)
                    }`}
                  >
                    {view.innovation.score ?? "—"}
                  </span>
                  <span className="text-sm text-muted-foreground">/ 100</span>
                </div>
                {view.innovation.summary && (
                  <p className="mt-2 text-sm text-muted-foreground">{view.innovation.summary}</p>
                )}
                {view.innovation.comparable && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    <strong className="text-foreground">Closest analogue:</strong>{" "}
                    {view.innovation.comparable}
                  </p>
                )}
                {view.innovation.markers.length > 0 && (
                  <>
                    <Separator className="my-4" />
                    <ul className="space-y-2">
                      {view.innovation.markers.map((marker) => (
                        <li key={marker.label} className="text-sm text-muted-foreground">
                          <strong className="text-foreground">{marker.label}:</strong>{" "}
                          {marker.detail ?? "—"}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </ReportSection>
            )}

            {view.interviewQuestions.length > 0 && (
              <ReportSection
                value="interview"
                title="Interview Questions"
                icon={<MessagesSquare className="h-4 w-4" />}
                count={view.interviewQuestions.length}
              >
                <ol className="space-y-3">
                  {view.interviewQuestions.map((q, i) => (
                    <li key={`${q}-${i}`} className="flex gap-3 text-sm">
                      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 font-mono text-xs text-primary">
                        {i + 1}
                      </span>
                      <span className="text-muted-foreground">{q}</span>
                    </li>
                  ))}
                </ol>
              </ReportSection>
            )}

            {view.judgeQuestions.length > 0 && (
              <ReportSection
                value="judge"
                title="Judge Questions"
                icon={<Gavel className="h-4 w-4" />}
                count={view.judgeQuestions.length}
              >
                <ol className="space-y-3">
                  {view.judgeQuestions.map((q, i) => (
                    <li key={`${q}-${i}`} className="flex gap-3 text-sm">
                      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 font-mono text-xs text-primary">
                        {i + 1}
                      </span>
                      <span className="text-muted-foreground">{q}</span>
                    </li>
                  ))}
                </ol>
              </ReportSection>
            )}

            {view.timeline.length > 0 && (
              <ReportSection
                value="timeline"
                title="Timeline"
                icon={<GitBranch className="h-4 w-4" />}
              >
                <ol className="relative ml-2 space-y-4 border-l border-border pl-6">
                  {view.timeline.map((entry, i) => (
                    <motion.li
                      key={`${entry.time}-${i}`}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="relative"
                    >
                      <span className="absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                      <p className="font-mono text-xs text-muted-foreground">{entry.time}</p>
                      <p className="text-sm">{entry.event}</p>
                    </motion.li>
                  ))}
                </ol>
              </ReportSection>
            )}
          </Accordion>
        )}
      </div>
    </AppLayout>
  );
}
