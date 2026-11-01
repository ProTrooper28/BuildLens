import { getSupabase } from "@/lib/supabase";
import type { Project, ProjectInsert, ProjectUpdate } from "@/types/database";
import { toAuthMessage } from "@/utils/errors";

/**
 * List the signed-in user's project-manager projects, newest first.
 *
 * The `source` filter is the separation between the two workflows: rows the
 * Candidate Portal created for a hackathon submission carry
 * `source = "candidate_submission"` and are deliberately absent here. Reading
 * one of those rows still works through {@link getProject} (status page,
 * progress, judge detail) — they are just not listed as managed work.
 */
export async function listProjects(userId: string): Promise<Project[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", userId)
    .eq("source", "project_manager")
    .order("created_at", { ascending: false });
  if (error) throw new Error(toAuthMessage(error));
  return data ?? [];
}

/**
 * Read a single project by id, regardless of its source.
 *
 * Used by the status page, the progress page and the judge's detail view, all of
 * which need to show a project even when it was created through the Candidate
 * Portal (source = candidate_submission). They key off the project id from the
 * submission row or the report row, so they should never filter on source.
 */
export async function getProject(id: string): Promise<Project | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(toAuthMessage(error));
  return data;
}

/**
 * Create a project for the given owner and return the inserted row.
 *
 * `input.user_id` should be the authenticated user's id so RLS allows the insert.
 */
export async function createProject(input: ProjectInsert): Promise<Project> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("projects").insert(input).select("*").single();
  if (error) throw new Error(toAuthMessage(error));
  return data;
}

/**
 * Create the project row that backs a candidate's hackathon submission.
 *
 * The Candidate Portal must never file its record as managed work, so every
 * project created through the submission flow carries `source =
 * "candidate_submission"`. The Projects listing queries on that source, so the
 * separation lives in the data model and the query — not in any component's
 * filtering — and cannot be bypassed by forgetting a CSS class.
 *
 * The row remains readable by id through {@link getProject}, so the status page,
 * the progress page and the judge's detail view can still show it. The only place
 * it disappears is the Projects listing, which is meant to show managed work.
 */
export async function createCandidateProject(
  userId: string,
  input: Omit<ProjectInsert, "user_id" | "source">,
): Promise<Project> {
  return createProject({
    ...input,
    user_id: userId,
    status: input.status ?? ("draft" as const),
    source: "candidate_submission",
  });
}

/**
 * Create a draft project for the authenticated user and return the inserted row.
 *
 * This is the project-manager workflow: the row is tagged `source =
 * "project_manager"` so it appears in the Projects listing. It has no
 * hackathon submission and never enters a judge queue.
 *
 * Use this for project-manager-created work. Use {@link createCandidateProject}
 * for anything submitted through the Candidate Portal.
 */
export async function createProjectForUser(
  userId: string,
  input: Omit<ProjectInsert, "user_id" | "source">,
): Promise<Project> {
  return createProject({
    ...input,
    user_id: userId,
    status: input.status ?? ("draft" as const),
    source: "project_manager",
  });
}

/** Update a project and return the updated row. */
export async function updateProject(id: string, patch: ProjectUpdate): Promise<Project> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("projects")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(toAuthMessage(error));
  if (!data) throw new Error("Project not found.");
  return data;
}

/** Delete a project by id. */
export async function deleteProject(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw new Error(toAuthMessage(error));
}
