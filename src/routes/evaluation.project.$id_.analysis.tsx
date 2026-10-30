import { createFileRoute } from "@tanstack/react-router";

import { DetailedAnalysis } from "@/components/evaluation/DetailedAnalysis";
import { RequireRole } from "@/components/auth/RequireRole";

/**
 * `/evaluation/project/$id/analysis` — the technical evidence behind the judge
 * summary. The `$id_` segment keeps this route a sibling of the detail page
 * (which renders no `<Outlet />`), so the page replaces it instead of nesting.
 */
export const Route = createFileRoute("/evaluation/project/$id_/analysis")({
  head: () => ({
    meta: [
      { title: "Detailed Analysis — BuildLens" },
      {
        name: "description",
        content:
          "Technical evidence behind the judge summary: claims, deck, repository, deployment, security, performance and AI analysis.",
      },
    ],
  }),
  component: DetailedAnalysisPage,
});

function DetailedAnalysisPage() {
  const { id } = Route.useParams();
  return (
    <RequireRole role="manager">
      <DetailedAnalysis submissionId={id} />
    </RequireRole>
  );
}
