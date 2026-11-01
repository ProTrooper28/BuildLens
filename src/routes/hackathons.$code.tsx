import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";

import { HackathonWorkspace, type WorkspaceView } from "@/components/hackathons/HackathonWorkspace";
import { RealHackathonWorkspace } from "@/components/hackathons/RealHackathonWorkspace";
import { AppLayout } from "@/components/layout/AppLayout";
import { useJudgeWorkspace } from "@/hooks/useHackathonPortal";

const VIEWS: WorkspaceView[] = ["overview", "projects", "resumes", "rankings", "scores"];

function parseView(value: unknown): WorkspaceView {
  return VIEWS.includes(value as WorkspaceView) ? (value as WorkspaceView) : "overview";
}

export const Route = createFileRoute("/hackathons/$code")({
  // `view` is normalised rather than dropped: one canonical URL per section, so
  // opening an archive never bounces through a redirect to reach its overview.
  validateSearch: (search: Record<string, unknown>): { view: WorkspaceView } => ({
    view: parseView(search["view"]),
  }),
  head: () => ({
    meta: [
      { title: "Hackathon Workspace — BuildLens" },
      {
        name: "description",
        content: "Projects, resumes, rankings and scores for one hackathon code.",
      },
    ],
  }),
  component: HackathonRoutePage,
});

function HackathonRoutePage() {
  const { code } = Route.useParams();
  const { view } = Route.useSearch();
  const navigate = useNavigate();
  // One code, two sources: a real hackathon someone created (its judge workspace
  // reads the shared submission records) or one of the sample archives. The real
  // event always wins, so a code never shows demo data once it exists.
  const workspace = useJudgeWorkspace(code);
  // This route owns the nested page routes too (a project, a resume). Without an
  // outlet the child would never render — the workspace would swallow it.
  const nested = useRouterState({
    select: (state) => state.location.pathname.split("/").filter(Boolean).length > 2,
  });
  if (nested) return <Outlet />;

  if (workspace.isLoading) {
    return (
      <AppLayout title="Loading workspace" crumbs={[{ label: "Hackathons", to: "/hackathons" }]}>
        <div className="h-64 animate-pulse rounded-xl border border-border/70 bg-card/40" />
      </AppLayout>
    );
  }

  if (workspace.data) return <RealHackathonWorkspace code={code} />;

  return (
    <HackathonWorkspace
      code={code}
      view={view}
      onViewChange={(next) =>
        void navigate({ to: "/hackathons/$code", params: { code }, search: { view: next } })
      }
    />
  );
}
