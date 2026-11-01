import { createFileRoute } from "@tanstack/react-router";

import { SubmissionStatusPage } from "@/components/submission/SubmissionStatusPage";

export const Route = createFileRoute("/submission/$id")({
  head: () => ({
    meta: [
      { title: "Submission status — BuildLens" },
      {
        name: "description",
        content: "Submission received, submission check and analysis progress.",
      },
    ],
  }),
  component: SubmissionRoutePage,
});

function SubmissionRoutePage() {
  const { id } = Route.useParams();
  return <SubmissionStatusPage submissionId={id} />;
}
