import { createFileRoute } from "@tanstack/react-router";

import { SubmissionListPage } from "@/components/evaluation/SubmissionListPage";
import { RequireRole } from "@/components/auth/RequireRole";

export const Route = createFileRoute("/evaluation/resume/")({
  head: () => ({
    meta: [
      { title: "Resume Ranking — BuildLens" },
      {
        name: "description",
        content: "Browse, filter and evaluate candidate resumes in the BuildLens judging cohort.",
      },
    ],
  }),
  component: () => (
    <RequireRole role="manager">
      <SubmissionListPage category="resume" />
    </RequireRole>
  ),
});
