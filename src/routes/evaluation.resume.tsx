import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Resume evaluation layout.
 *
 * `/evaluation/resume` is `evaluation.resume.index.tsx`; resume detail pages
 * render through this outlet.
 */
export const Route = createFileRoute("/evaluation/resume")({
  component: () => <Outlet />,
});
