import type { Json, Project, Report, ReportStatus, ReportType } from "@/types/database";

/**
 * Guest submissions — the guest-safe persistence path.
 *
 * ## Why this is not Supabase
 *
 * `projects.user_id` and `reports.user_id` are `NOT NULL` and carry a foreign key
 * to `profiles.id` (verified against the live database: both
 * `projects_user_id_fkey` and `reports_user_id_fkey` resolve). An anonymous
 * visitor has no auth session, therefore no `auth.uid()`, therefore no `profiles`
 * row. Any insert would need either
 *
 *   1. a fabricated `user_id` / a row in `public.profiles` (explicitly off-limits), or
 *   2. a migration that relaxes `NOT NULL`/the FK or adds an anonymous insert policy
 *      (a schema change — must be approved first).
 *
 * So guest submissions are written to this browser instead. Nothing here ever
 * reaches Supabase: no fake UUID is invented, no RLS policy is bypassed, no second
 * backend is introduced, and authenticated users keep using their real Supabase
 * user id through `project.service` / `report.service` unchanged.
 *
 * Records mirror the table rows minus `user_id`, so the dashboard, report list and
 * report page render them with the same code paths.
 */
export type GuestProject = Omit<Project, "user_id" | "source">;
export type GuestReport = Omit<Report, "user_id">;

export interface GuestProjectInput {
  name: string;
  repo_url?: string | null;
  website_url?: string | null;
  description?: string | null;
}

export interface GuestReportInput {
  type: ReportType;
  name: string;
  project_id?: string | null;
  status?: ReportStatus;
  report_data?: Json | null;
}

interface GuestStore {
  projects: GuestProject[];
  reports: GuestReport[];
}

const STORAGE_KEY = "buildlens-guest-submissions";

/**
 * A fresh empty store.
 *
 * Never a shared module-level constant: callers push into the object they read,
 * so a reused reference would leak rows across reads while storage looks empty.
 */
function emptyStore(): GuestStore {
  return { projects: [], reports: [] };
}

/** True when browser storage is available (false during SSR / private mode). */
function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStore(): GuestStore {
  if (!hasStorage()) return emptyStore();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<GuestStore>;
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      reports: Array.isArray(parsed.reports) ? parsed.reports : [],
    };
  } catch {
    // Corrupt or unreadable payload — treat as empty rather than crashing the flow.
    return emptyStore();
  }
}

function writeStore(store: GuestStore): boolean {
  if (!hasStorage()) return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    // Quota exceeded / private mode — the submission stays in memory for this page.
    return false;
  }
}

/** Client-generated UUID (never sent to Supabase) for guest rows. */
function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** List guest projects, newest first. */
export function listGuestProjects(): GuestProject[] {
  return [...readStore().projects].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** List guest reports, newest first. */
export function listGuestReports(): GuestReport[] {
  return [...readStore().reports].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Fetch one guest project by id, or `null`. */
export function getGuestProject(id: string): GuestProject | null {
  return readStore().projects.find((p) => p.id === id) ?? null;
}

/**
 * Fetch one guest report by id, or `null`.
 *
 * Only ever reads this browser's storage — safe to call for any id shape before
 * deciding whether Supabase should be queried.
 */
export function getGuestReport(id: string): GuestReport | null {
  return readStore().reports.find((r) => r.id === id) ?? null;
}

/** Create a guest project in local storage and return the stored row. */
export function createGuestProject(input: GuestProjectInput): GuestProject {
  const now = new Date().toISOString();
  const project: GuestProject = {
    id: newId(),
    name: input.name,
    repo_url: input.repo_url ?? null,
    website_url: input.website_url ?? null,
    description: input.description ?? null,
    status: "draft",
    created_at: now,
    updated_at: now,
  };
  const store = readStore();
  store.projects.push(project);
  writeStore(store);
  return project;
}

/** Create a guest report in local storage and return the stored row. */
export function createGuestReport(input: GuestReportInput): GuestReport {
  const now = new Date().toISOString();
  const report: GuestReport = {
    id: newId(),
    project_id: input.project_id ?? null,
    type: input.type,
    name: input.name,
    status: input.status ?? "In Progress",
    score: null,
    report_data: input.report_data ?? null,
    created_at: now,
    updated_at: now,
  };
  const store = readStore();
  store.reports.push(report);
  writeStore(store);
  return report;
}

/**
 * Update a guest report in local storage.
 *
 * Used by the analysis pipeline so guest reports get the same lifecycle as
 * authenticated ones (In Progress → Completed/Failed) without ever touching
 * Supabase or inventing a `user_id`.
 */
export function updateGuestReport(
  id: string,
  patch: Partial<Omit<GuestReport, "id" | "created_at">>,
): GuestReport | null {
  const store = readStore();
  const index = store.reports.findIndex((report) => report.id === id);
  if (index === -1) return null;
  const current = store.reports[index];
  if (!current) return null;
  const updated: GuestReport = {
    id: current.id,
    created_at: current.created_at,
    project_id: patch.project_id === undefined ? current.project_id : patch.project_id,
    type: patch.type ?? current.type,
    name: patch.name ?? current.name,
    status: patch.status ?? current.status,
    score: patch.score === undefined ? current.score : patch.score,
    report_data: patch.report_data === undefined ? current.report_data : patch.report_data,
    updated_at: new Date().toISOString(),
  };
  store.reports[index] = updated;
  writeStore(store);
  return updated;
}

/** Remove a guest report from local storage. */
export function deleteGuestReport(id: string): void {
  const store = readStore();
  store.reports = store.reports.filter((r) => r.id !== id);
  writeStore(store);
}

/**
 * Remove a guest project from local storage.
 *
 * Used to undo a half-created guest submission: when the report or the portal
 * record cannot be written, the project row is removed again so a retry does not
 * accumulate orphan projects.
 */
export function deleteGuestProject(id: string): void {
  const store = readStore();
  store.projects = store.projects.filter((p) => p.id !== id);
  writeStore(store);
}
