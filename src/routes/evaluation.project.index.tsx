import { createFileRoute } from "@tanstack/react-router";

import { SubmissionListPage } from "@/components/evaluation/SubmissionListPage";
import { RequireRole } from "@/components/auth/RequireRole";

export const Route = createFileRoute("/evaluation/project/")({
  head: () => ({
    meta: [
      { title: "Project Ranking — BuildLens" },
      {
        name: "description",
        content: "Browse, filter and evaluate submitted projects in the BuildLens judging cohort.",
      },
    ],
  }),
  component: () => (
    <RequireRole role="manager">
      <SubmissionListPage category="project" />
    </RequireRole>
  ),
});
