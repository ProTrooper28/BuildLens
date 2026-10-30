import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Project evaluation layout.
 *
 * `/evaluation/project` is `evaluation.project.index.tsx`; detail pages and the
 * detailed analysis page render through this outlet.
 */
export const Route = createFileRoute("/evaluation/project")({
  component: () => <Outlet />,
});
