import { createFileRoute, Link } from "@tanstack/react-router";

import { motion } from "framer-motion";
import {
  Archive,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  FolderGit2,
  Gavel,
  History,
  Plus,
  TrendingUp,
  UserRound,
  UserSearch,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AppLayout } from "@/components/layout/AppLayout";
import { EmptyState } from "@/components/state/EmptyState";
import { BrandMark } from "@/components/brand/BrandLogo";
import { ErrorState } from "@/components/state/ErrorState";
import { CardRowSkeleton } from "@/components/state/skeletons";
import { scoreTone } from "@/components/ScoreRing";
import {
  AmbientCard,
  AnimatedNumber,
  EASE_OUT,
  StaggerContainer,
  StaggerItem,
} from "@/components/motion/primitives";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { useAuth } from "@/hooks/useAuth";
import { useCandidateSubmissions } from "@/hooks/useHackathonPortal";
import { SubmissionLifecycleCard } from "@/components/hackathons/SubmissionLifecycleCard";
import { useProjectsQuery, useReportsQuery } from "@/hooks/useWorkspaceQueries";
import type { UserRole } from "@/types/auth";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/toast-messages";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — BuildLens" },
      {
        name: "description",
        content: "Start a project or developer review, or browse previous reports.",
      },
      { property: "og:title", content: "Dashboard — BuildLens" },
      { property: "og:description", content: "Your BuildLens workspace." },
    ],
  }),
  component: Dashboard,
});

interface QuickAction {
  icon: typeof FileText;
  title: string;
  text: string;
  cta: string;
  to: string;
}

/**
 * The dashboard opens on the work of the signed-in role: candidates get their
 * own submission loop, managers get the administrative doors.
 */
function quickActions(role: UserRole): readonly QuickAction[] {
  if (role === "manager") {
    return [
      {
        icon: Archive,
        title: "Hackathon Archives",
        text: "Open a hackathon to review its candidates, projects, evaluations and rankings.",
        cta: "Open Archives",
        to: "/hackathons",
      },
      {
        icon: Gavel,
        title: "Evaluate Submissions",
        text: "Score resumes and projects against your rubric and file your decisions.",
        cta: "Start Evaluating",
        to: "/evaluation",
      },
      {
        icon: History,
        title: "Report History",
        text: "Revisit, compare and share the reports already generated in your workspace.",
        cta: "View Reports",
        to: "/reports",
      },
    ];
  }
  return [
    {
      icon: FolderGit2,
      title: "Submit a Project",
      text: "Share your repository, live site and deck — BuildLens gathers the evidence and scores it.",
      cta: "New Submission",
      to: "/review/project",
    },
    {
      icon: History,
      title: "Your Reports",
      text: "Read the evaluation, score and results generated for your own submissions.",
      cta: "View Reports",
      to: "/reports",
    },
    {
      icon: UserRound,
      title: "Your Profile",
      text: "Keep your name and organization up to date, and see which workspace you're in.",
      cta: "Open Profile",
      to: "/profile",
    },
  ];
}

const statusClass = (status: string): string => {
  if (status === "Completed") return "border-success/30 bg-success/10 text-success";
  if (status === "In Progress") return "border-warning/30 bg-warning/10 text-warning";
  if (status === "Failed") return "border-destructive/30 bg-destructive/10 text-destructive";
  return "border-muted bg-muted/50 text-muted-foreground";
};

const projectStatusLabel = (status: string): string => {
  if (status === "completed") return "Completed";
  if (status === "in_review") return "In review";
  return "Draft";
};

const projectStatusClass = (status: string): string => {
  if (status === "completed") return "border-success/30 bg-success/10 text-success";
  if (status === "in_review") return "border-warning/30 bg-warning/10 text-warning";
  return "border-muted bg-muted/50 text-muted-foreground";
};

/** A single workspace stat: animated value, accent icon, hover spotlight. */
function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  valueClass,
  iconClass,
  pulse = false,
}: {
  label: string;
  value: number;
  hint: string;
  icon: typeof FileText;
  valueClass?: string;
  iconClass?: string;
  pulse?: boolean;
}) {
  return (
    <SpotlightCard
      theme="dark"
      intensity={0.1}
      spotlightSize={220}
      softness={0.8}
      shape="circle"
      borderGlow={0.35}
      proximity={60}
      smoothing={0.25}
      ambient={false}
      flare
      grain={0}
      className="surface stat-card group h-full p-6"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span
          className={cn(
            "grid h-8 w-8 place-items-center rounded-lg bg-muted/60 text-muted-foreground transition-colors duration-300 group-hover:bg-primary/10 group-hover:text-primary",
            iconClass,
          )}
          aria-hidden
        >
          <Icon
            className={cn(
              "h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5",
              pulse && "animate-status-pulse",
            )}
          />
        </span>
      </div>
      <p className={cn("mt-3 text-3xl font-semibold tracking-tight", valueClass)}>
        <AnimatedNumber value={value} />
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </SpotlightCard>
  );
}

function Dashboard() {
  const { user, isLoading: authLoading, profile, role } = useAuth();
  const cards = quickActions(role);

  // Cached in React Query: returning to the dashboard paints real rows on the
  // first frame and revalidates in the background instead of refetching.
  const reportsQuery = useReportsQuery(user?.id);
  const projectsQuery = useProjectsQuery(user?.id);
  // Submissions sent to a hackathon — the judge portal reads these same rows.
  const submissionsQuery = useCandidateSubmissions();
  const portalSubmissions = submissionsQuery.data ?? [];

  const reportsList = reportsQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const loading = reportsQuery.isLoading;
  const failed = reportsQuery.isError && reportsList.length === 0;
  const projectsLoading = projectsQuery.isLoading;
  const projectsFailed = projectsQuery.isError && projects.length === 0;

  const retryProjects = () => {
    void projectsQuery.refetch();
  };

  const retryReports = () => {
    void reportsQuery.refetch();
  };

  const completed = reportsList.filter((r) => r.status === "Completed");
  const avg =
    completed.length > 0
      ? Math.round(completed.reduce((a, r) => a + (r.score ?? 0), 0) / completed.length)
      : 0;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = reportsList.filter((r) => new Date(r.created_at).getTime() >= weekAgo).length;
  const inProgress = reportsList.filter((r) => r.status === "In Progress").length;
  const recent = reportsList.slice(0, 4);

  if (authLoading || !user) {
    return (
      <AppLayout
        title="Good evening"
        subtitle="What would you like to evaluate today?"
        crumbs={[{ label: "Dashboard" }]}
      >
        <section
          aria-label="Workspace stats"
          className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <CardRowSkeleton key={i} />
          ))}
        </section>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title="Good evening"
      subtitle={
        profile?.full_name
          ? `Welcome back, ${profile.full_name.split(" ")[0]}.`
          : role === "manager"
            ? "Your hackathons, candidates and evaluations at a glance."
            : "Your projects, evaluations and results at a glance."
      }
      crumbs={[{ label: "Dashboard" }]}
    >
      {/* Stats strip */}
      <section
        aria-label="Workspace stats"
        className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <CardRowSkeleton key={i} />)
        ) : failed ? (
          <div className="sm:col-span-2 lg:col-span-4">
            <ErrorState
              title="Couldn't load workspace stats"
              description="Your reports didn't come through."
              onRetry={retryReports}
            />
          </div>
        ) : (
          <StaggerContainer className="contents">
            <StaggerItem>
              <StatCard
                label="Total reports"
                value={reportsList.length}
                hint="All evaluations to date"
                icon={FileText}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label="Completed this week"
                value={thisWeek}
                hint="Reports ready to share"
                icon={CheckCircle2}
                valueClass="text-success"
                iconClass="text-success"
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label="Average score"
                value={avg}
                hint={
                  completed.length > 0
                    ? `Across ${completed.length} completed reports`
                    : "No completed reports yet"
                }
                icon={TrendingUp}
                valueClass={completed.length > 0 ? scoreTone(avg) : "text-muted-foreground"}
              />
            </StaggerItem>
            <StaggerItem>
              <StatCard
                label="In progress"
                value={inProgress}
                hint="Still gathering evidence"
                icon={Clock3}
                valueClass="text-warning"
                iconClass="text-warning"
                pulse={inProgress > 0}
              />
            </StaggerItem>
          </StaggerContainer>
        )}
      </section>

      {/* Hackathon submissions — status as the judges see it, plus published results */}
      {portalSubmissions.length > 0 && (
        <section aria-label="Hackathon submissions" className="mb-10">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Hackathon submissions</h2>
            <p className="text-sm text-muted-foreground">
              The records the judges score — lifecycle status and any published result.
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {portalSubmissions.map(({ submission, hackathon }) => (
              <div key={submission.id} className="flex flex-col gap-2">
                <SubmissionLifecycleCard hackathon={hackathon} submission={submission} />
                <Link
                  to="/submission/$id"
                  params={{ id: submission.id }}
                  className="inline-flex items-center gap-1 self-start text-xs text-primary hover:underline"
                >
                  Open submission status <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Projects */}
      <section aria-label="Your projects" className="mb-10">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold">Projects</h2>
            <p className="text-sm text-muted-foreground">
              Repositories, live sites and pitch materials you've submitted.
            </p>
          </div>
          <Button asChild variant="hero" size="sm" className="gap-1.5">
            <Link to="/review/project">
              <Plus className="h-3.5 w-3.5" /> New project
            </Link>
          </Button>
        </div>

        {projectsLoading ? (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="surface space-y-3 p-6">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
            ))}
          </div>
        ) : projectsFailed ? (
          <div className="surface">
            <ErrorState
              compact
              title="Projects unavailable"
              description="Your projects didn't come through."
              onRetry={retryProjects}
              className="rounded-none"
            />
          </div>
        ) : projects.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE_OUT }}
            className="relative overflow-hidden rounded-xl border border-border/80 bg-card/50 px-6 py-12 text-center transition-colors duration-200 hover:border-primary/25 hover:bg-card/70"
          >
            <div className="relative mx-auto flex max-w-md flex-col items-center">
              <span
                aria-hidden
                className="grid h-14 w-14 place-items-center rounded-2xl border border-border/80 bg-muted/40 text-muted-foreground"
              >
                <FolderGit2 className="h-6 w-6" />
              </span>
              <p className="mt-5 text-base font-medium">No projects yet</p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Submit a repository, live site and deck. BuildLens gathers the evidence and scores
                the project for you.
              </p>
              <Button asChild variant="hero" size="lg" className="mt-6">
                <Link to="/review/project">
                  Review a project <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <ol className="mt-8 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                {["Evidence", "Repository", "Evaluation", "Score", "Report"].map((step, i) => (
                  <li key={step} className="flex items-center gap-2">
                    <span className="rounded-full border border-border/70 bg-background/40 px-2 py-0.5">
                      {step}
                    </span>
                    {i < 4 && (
                      <span aria-hidden className="text-border">
                        →
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </motion.div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((p, i) => (
              <motion.article
                key={p.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="surface flex flex-col p-6"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-medium">{p.name}</h3>
                  <Badge variant="outline" className={projectStatusClass(p.status)}>
                    {projectStatusLabel(p.status)}
                  </Badge>
                </div>
                {p.description ? (
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{p.description}</p>
                ) : null}
                <dl className="mt-4 space-y-1.5 text-xs text-muted-foreground">
                  {p.repo_url ? (
                    <div className="flex items-center gap-2">
                      <dt className="sr-only">Repository</dt>
                      <dd className="min-w-0 truncate">
                        <a
                          href={p.repo_url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-foreground hover:underline"
                        >
                          {p.repo_url}
                        </a>
                      </dd>
                    </div>
                  ) : null}
                  {p.website_url ? (
                    <div className="flex items-center gap-2">
                      <dt className="sr-only">Live site</dt>
                      <dd className="min-w-0 truncate">
                        <a
                          href={p.website_url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-foreground hover:underline"
                        >
                          {p.website_url}
                        </a>
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2">
                    <dt className="sr-only">Submitted</dt>
                    <dd>Submitted {new Date(p.created_at).toLocaleDateString()}</dd>
                  </div>
                </dl>
              </motion.article>
            ))}
          </div>
        )}
      </section>

      {/* Recent activity */}
      <section aria-label="Recent reports" className="mb-10">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold">Recent reports</h2>
            <p className="text-sm text-muted-foreground">
              Everything you've evaluated, newest first.
            </p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/reports">
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
        <div className="surface overflow-hidden">
          {loading ? (
            <div className="px-2 py-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 border-b border-border/60 px-4 py-4 last:border-0"
                >
                  <Skeleton className="h-9 w-9 rounded-lg" />
                  <Skeleton className="h-4 w-48 flex-1" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-12" />
                </div>
              ))}
            </div>
          ) : failed ? (
            <ErrorState
              compact
              title="Recent reports unavailable"
              onRetry={retryReports}
              className="rounded-none"
            />
          ) : recent.length === 0 ? (
            <EmptyState
              icon={<BrandMark size="sm" />}
              title="No reports yet"
              description="Once you review a project or developer, reports appear here."
              action={
                <Button asChild size="sm" variant="outline">
                  <Link to="/review/project">Create your first review</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {recent.map((r, i) => (
                <motion.li
                  key={r.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Link
                    to="/report/$id"
                    params={{ id: r.id }}
                    className="group flex items-center gap-4 px-4 py-4 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted">
                      {r.type === "Project" ? (
                        <FolderGit2 className="h-4 w-4" />
                      ) : (
                        <UserSearch className="h-4 w-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(r.created_at).toISOString().slice(0, 10)} · {r.type} review
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`hidden sm:inline-flex ${statusClass(r.status)}`}
                    >
                      {r.status}
                    </Badge>
                    <span
                      className={`w-10 text-right font-mono text-sm tabular-nums ${r.score ? scoreTone(r.score) : "text-muted-foreground"}`}
                    >
                      {r.score ?? "—"}
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
                  </Link>
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Quick actions */}
      <section aria-label="Quick actions" className="grid gap-5 md:grid-cols-3">
        {cards.map((c, i) => (
          <motion.div
            key={c.title}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + i * 0.08, ease: EASE_OUT }}
          >
            <AmbientCard className="surface group flex h-full flex-col p-7">
              <span className="grid h-12 w-12 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary transition-transform duration-300 group-hover:-translate-y-0.5">
                <c.icon className="h-6 w-6" />
              </span>
              <h2 className="mt-6 text-lg font-semibold">{c.title}</h2>
              <p className="mt-2 flex-1 text-sm text-muted-foreground">{c.text}</p>
              <Button
                asChild
                className="mt-8 w-full"
                variant={i === 2 ? "secondary" : "default"}
                onClick={() => notify.info("Opening flow", `${c.title} started.`)}
              >
                <Link to={c.to}>
                  {c.cta}{" "}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </Button>
            </AmbientCard>
          </motion.div>
        ))}
      </section>
    </AppLayout>
  );
}
