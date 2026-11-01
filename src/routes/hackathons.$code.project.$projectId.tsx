import { createFileRoute } from "@tanstack/react-router";

import { RealProjectPage } from "@/components/hackathons/RealProjectPage";
import { ProjectScoringView } from "@/components/hackathons/ProjectScoringView";
import { AppLayout } from "@/components/layout/AppLayout";
import { useJudgeProject } from "@/hooks/useHackathonPortal";

export const Route = createFileRoute("/hackathons/$code/project/$projectId")({
  head: () => ({
    meta: [
      { title: "Project — BuildLens" },
      {
        name: "description",
        content: "The candidate's submission, the BuildLens analysis and the judge's evaluation.",
      },
    ],
  }),
  component: ProjectRoutePage,
});

function ProjectRoutePage() {
  const { code, projectId } = Route.useParams();
  // The shared submission id decides which page this is: a candidate submission
  // opens the real project page (submission + analysis + judging), while the
  // sample archives keep their own scoring view.
  const project = useJudgeProject(code, projectId);

  if (project.isLoading) {
    return (
      <AppLayout title="Loading project" crumbs={[{ label: "Hackathons", to: "/hackathons" }]}>
        <div className="h-64 animate-pulse rounded-xl border border-border/70 bg-card/40" />
      </AppLayout>
    );
  }

  if (project.data) return <RealProjectPage code={code} submissionId={projectId} />;

  return <ProjectScoringView code={code} projectId={projectId} />;
}
