import { getSupabase } from "@/lib/supabase";
import type { Report, ReportInsert, ReportUpdate } from "@/types/database";
import { toAuthMessage } from "@/utils/errors";

/**
 * Projection rows used by the list pages: only the columns the UI renders.
 * The full `report_data` JSON (which can be tens of KB) is deliberately left
 * out of these queries so history and the dashboard never transfer it.
 */
export type ReportSummary = Pick<
  Report,
  "id" | "user_id" | "project_id" | "type" | "name" | "status" | "score" | "created_at" | "updated_at"
>;

/** List the signed-in user's reports (summary projection, newest first). */
export async function listReports(userId: string): Promise<ReportSummary[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("reports")
    .select("id, user_id, project_id, type, name, status, score, created_at, updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(toAuthMessage(error));
  return data ?? [];
}

/** Parallel list of the signed-in user's reports (summary projection). */
export async function listReportsParallel(userId: string): Promise<ReportSummary[]> {
  return listReports(userId);
}

/**
 * Shape of a Postgres `uuid` literal.
 *
 * The `reports.id` column is `uuid`, so Postgres rejects any other string with a
 * hard error (`invalid input syntax for type uuid`). Route params are
 * user-controlled, so malformed ids are treated as "not found" before querying
 * rather than surfaced as a database error.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is a well-formed UUID that Postgres can cast. */
export function isReportId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Fetch a single report by id (summary projection for the /report/$id page
 * shell; keeps the 100+ KB `report_data` payload off the initial request).
 */
export async function getReportSummary(id: string): Promise<ReportSummary | null> {
  if (!isReportId(id)) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("reports")
    .select("id, user_id, project_id, type, name, status, score, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(toAuthMessage(error));
  return data ?? null;
}

/** Fetch the full row (with report_data) — only used on the individual report page. */
export async function getReport(id: string): Promise<Report | null> {
  if (!isReportId(id)) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase.from("reports").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(toAuthMessage(error));
  return data;
}

/**
 * Create a report for the given owner and return the inserted row.
 *
 * `input.user_id` should be the authenticated user's id so RLS allows the insert.
 */
export async function createReport(input: ReportInsert): Promise<Report> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("reports").insert(input).select("*").single();
  // Keep the raw PostgREST error available for logging (see createProject).
  if (error) throw new Error(toAuthMessage(error), { cause: error });
  return data;
}

/**
 * Create a report for the authenticated user and return the inserted row.
 *
 * This is the preferred helper for report-creation flows because it ensures the
 * correct owner and a safe default status.
 */
export async function createReportForUser(
  userId: string,
  input: Omit<ReportInsert, "user_id">,
): Promise<Report> {
  return createReport({
    ...input,
    user_id: userId,
    status: input.status ?? ("In Progress" as const),
  });
}

/** Update a report and return the updated row. */
export async function updateReport(id: string, patch: ReportUpdate): Promise<Report> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("reports")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(toAuthMessage(error));
  if (!data) throw new Error("Report not found.");
  return data;
}

/** Delete a report by id. */
export async function deleteReport(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("reports").delete().eq("id", id);
  if (error) throw new Error(toAuthMessage(error), { cause: error });
}
