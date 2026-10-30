import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Evaluation section layout.
 *
 * `/evaluation` itself is `evaluation.index.tsx`; project/resume lists and their
 * detail pages render here. Without this `<Outlet />`, TanStack Router matches
 * the child route but has nowhere to mount it.
 */
export const Route = createFileRoute("/evaluation")({
  component: EvaluationLayout,
});

function EvaluationLayout() {
  return <Outlet />;
}
