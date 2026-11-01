/**
 * Shared hackathon portal service.
 *
 * One record set behind both portals (supabase/migrations/0007_hackathon_portal.sql):
 *
 *   hackathon  — code, name, dates, status, rubric
 *   submission — the candidate's project, whose `id` is the canonical project id
 *                used by the candidate page, the judge page, the analysis run,
 *                the evidence bundle, scoring and rankings
 *
 * ## Two interchangeable paths
 *
 * The judging and guest services already establish the pattern: try the database,
 * and fall back to a browser-local journal when Supabase is not configured, the
 * visitor is a guest, or `0007_hackathon_portal.sql` has not been applied yet.
 * The fallback is never disguised — `portalStorageNotice()` tells the UI which
 * path is live.
 *
 * ## Isolation is a service rule, not a UI rule
 *
 * Every judge-side read takes the viewer's id and filters on the hackathons that
 * viewer owns or is assigned to. The database enforces the same rule with RLS
 * (`is_hackathon_judge`), and re-checks it in the local path here, so a project
 * submitted to Hackathon A can never be listed or opened from Hackathon B.
 */

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { defaultCriteriaSet } from "@/lib/evaluation/criteria";
import { LOCAL_JUDGE_ID } from "@/services/judging/store";
import type {
  CandidateSubmission,
  CreateHackathonInput,
  Hackathon,
  HackathonStatus,
  HackathonSubmission,
  HackathonSummary,
  JudgeSubmission,
  PublishedResult,
  SubmissionStatus,
  SubmitProjectInput,
} from "@/types/hackathon";
import type { CriteriaSet } from "@/types/evaluation";
import type {
  HackathonRow,
  HackathonStatusRow,
  HackathonSubmissionRow,
  SubmissionStatusRow,
} from "@/types/database";

/* ------------------------------------------------------------------ identity */

/** The id guest submissions are filed under (no auth session exists). */
export const LOCAL_PORTAL_CANDIDATE_ID = "local-candidate";

/**
 * The candidate id for the current visitor.
 *
 * A signed-in user is their `auth.users.id`; a guest is this browser's local
 * candidate, which is the same identity the local journal already uses.
 *
 * Guest mode wins over a session: a guest's project and report rows live in this
 * browser, so their submission has to be keyed by the local candidate id too.
 * Deriving an `auth.users.id` for one side of that pair would create a submission
 * pointing at project/report ids the database has never seen.
 */
export function portalCandidateId(userId: string | null, isGuest: boolean): string {
  return isGuest ? LOCAL_PORTAL_CANDIDATE_ID : (userId ?? "");
}

/** The judge identity for the current viewer: their user id, or the local judge. */
export function portalJudgeId(userId: string | null): string {
  return userId ?? LOCAL_JUDGE_ID;
}

/** True when this viewer is the browser-local prototype identity. */
function isLocalViewer(viewerId: string): boolean {
  return !viewerId || viewerId === LOCAL_JUDGE_ID || viewerId === LOCAL_PORTAL_CANDIDATE_ID;
}

/* ---------------------------------------------------------------- lifecycle */

/**
 * The lifecycle both portals display, in order.
 *
 * These are the statuses the product actually uses: a candidate can see
 * "received → processing → analyzed", a judge drives "under review →
 * evaluated", and publishing the result finalizes it.
 */
export const SUBMISSION_LIFECYCLE: readonly {
  key: SubmissionStatus;
  label: string;
  description: string;
}[] = [
  {
    key: "submitted",
    label: "Submission received",
    description: "The project, deck and links are stored under the hackathon.",
  },
  {
    key: "processing",
    label: "Analysis in progress",
    description: "Documents, repository and deployment are being inspected.",
  },
  {
    key: "analyzed",
    label: "Analysis complete",
    description: "The evidence bundle is ready for the judges.",
  },
  {
    key: "under_review",
    label: "Evaluation in progress",
    description: "A judge has opened the submission and started scoring.",
  },
  {
    key: "evaluated",
    label: "Evaluation complete",
    description: "A judge submitted a score against the rubric.",
  },
  {
    key: "finalized",
    label: "Result published",
    description: "The result is visible on the candidate's own page.",
  },
] as const;

const STATUS_ORDER: SubmissionStatus[] = SUBMISSION_LIFECYCLE.map((step) => step.key);

/** How far along the lifecycle a status is (1-based; 0 means unknown). */
export function lifecycleStage(status: SubmissionStatus): number {
  const index = STATUS_ORDER.indexOf(status);
  return index === -1 ? 0 : index + 1;
}

/** True when `next` is at or past `current` in the lifecycle. */
export function isStatusAtLeast(current: SubmissionStatus, next: SubmissionStatus): boolean {
  return lifecycleStage(current) >= lifecycleStage(next);
}

const STATUS_LABEL: Record<SubmissionStatus, string> = {
  submitted: "Submission received",
  processing: "Analysis in progress",
  analyzed: "Analysis complete",
  under_review: "Under review",
  evaluated: "Evaluation complete",
  finalized: "Result published",
};

export function submissionStatusLabel(status: SubmissionStatus): string {
  return STATUS_LABEL[status] ?? status;
}

/** The candidate-facing wording of a status. */
export function candidateStatusLabel(status: SubmissionStatus): string {
  return STATUS_LABEL[status] ?? status;
}

/* ---------------------------------------------------------------- join codes */

/**
 * Normalise a typed join code: ` hack-01 → HACK-01`.
 *
 * Anything with characters a code cannot contain comes back empty so the caller
 * can reject it instead of querying the database with it.
 */
export function normaliseJoinCode(input: string): string {
  const trimmed = input.trim().toUpperCase().replace(/\s+/g, "-");
  return /^[A-Z0-9][A-Z0-9-]{2,31}$/.test(trimmed) ? trimmed : "";
}

/** A readable, unique-looking code derived from the hackathon name. */
export function generateJoinCode(name: string): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 14);
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${slug || "HACK"}-${random}`;
}

/* ------------------------------------------------------------------ storage */

export type PortalStorage = "remote" | "local" | "probing";

let storageState: PortalStorage = "probing";

export function portalStorage(): PortalStorage {
  return storageState;
}

/** Whether the database path is worth trying for this viewer. */
export function canUseRemotePortal(viewerId: string | null | undefined): boolean {
  return Boolean(viewerId) && !isLocalViewer(viewerId as string) && isSupabaseConfigured;
}

/** PostgREST/Postgres errors that mean "0007 has not been applied". */
function isMissingPortalTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message, details, hint } = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };
  if (code === "42P01" || code === "PGRST205" || code === "42883") return true;
  const text = [message, details, hint]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
  if (!text) return false;
  return (
    (text.includes("relation") && text.includes("does not exist")) ||
    (text.includes("table") && text.includes("not find")) ||
    text.includes("schema cache") ||
    text.includes("could not find the table") ||
    (text.includes("function") && text.includes("does not exist"))
  );
}

/**
 * Run a portal operation remotely, falling back to the local journal only when
 * the tables/functions are genuinely absent. RLS denials and network failures
 * are re-thrown: those are real errors and must stay visible.
 */
async function runPortal<T>(
  useRemote: boolean,
  remote: () => Promise<T>,
  local: () => Promise<T> | T,
): Promise<T> {
  if (!useRemote) {
    storageState = "local";
    return local();
  }
  if (storageState === "local") return local();
  try {
    const result = await remote();
    storageState = "remote";
    return result;
  } catch (error) {
    if (isMissingPortalTable(error)) {
      storageState = "local";
      return local();
    }
    throw error;
  }
}

/** Honest description of where portal data is stored right now. */
export function portalStorageNotice(): { tone: "info" | "warning"; text: string } | null {
  if (storageState === "local") {
    return {
      tone: "warning",
      text: "Hackathons and submissions are stored in this browser. Sign in and apply supabase/migrations/0007_hackathon_portal.sql to share them between the candidate and judge portals.",
    };
  }
  return null;
}

/** Exposed for tests: forget the cached storage decision. */
export function resetPortalStorageState(): void {
  storageState = "probing";
}

/* ------------------------------------------------------------------ journal */

const JOURNAL_KEY = "buildlens-hackathon-portal-v1";

interface PortalJournal {
  hackathons: Hackathon[];
  judges: { hackathonId: string; judgeId: string }[];
  submissions: HackathonSubmission[];
}

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function emptyJournal(): PortalJournal {
  return { hackathons: [], judges: [], submissions: [] };
}

function readJournal(): PortalJournal {
  if (!hasStorage()) return emptyJournal();
  try {
    const raw = window.localStorage.getItem(JOURNAL_KEY);
    if (!raw) return emptyJournal();
    const parsed = JSON.parse(raw) as Partial<PortalJournal>;
    return {
      hackathons: Array.isArray(parsed.hackathons) ? parsed.hackathons : [],
      judges: Array.isArray(parsed.judges) ? parsed.judges : [],
      submissions: Array.isArray(parsed.submissions) ? parsed.submissions : [],
    };
  } catch {
    return emptyJournal();
  }
}

function writeJournal(journal: PortalJournal): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal));
  } catch {
    /* quota exceeded — the session keeps working from memory */
  }
}

function newId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") return cryptoObj.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ mapping */

function toHackathon(row: HackathonRow): Hackathon {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status as HackathonStatus,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    criteria: Array.isArray(row.criteria)
      ? (row.criteria as unknown as CriteriaSet["criteria"])
      : ([] as CriteriaSet["criteria"]),
    maxScore: row.max_score,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSubmission(row: HackathonSubmissionRow): HackathonSubmission {
  const members = Array.isArray(row.team_members)
    ? (row.team_members as unknown[]).filter((m): m is string => typeof m === "string")
    : [];
  const published =
    row.published_result && typeof row.published_result === "object"
      ? (row.published_result as unknown as PublishedResult)
      : null;
  return {
    id: row.id,
    hackathonId: row.hackathon_id ?? null,
    candidateId: row.candidate_id,
    projectId: row.project_id,
    reportId: row.report_id,
    teamName: row.team_name,
    teamMembers: members,
    description: row.description,
    repoUrl: row.repo_url,
    websiteUrl: row.website_url,
    demoUrl: row.demo_url,
    deckName: row.deck_name,
    status: row.status as SubmissionStatus,
    analysisRunId: row.analysis_run_id,
    resultPublished: row.result_published,
    publishedResult: published,
    publishedAt: row.published_at,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------------------------------------------- access */

/** True when this viewer may judge (read and score) the hackathon. */
function localCanJudge(journal: PortalJournal, hackathonId: string, viewerId: string): boolean {
  const hackathon = journal.hackathons.find((entry) => entry.id === hackathonId);
  if (!hackathon) return false;
  if (hackathon.createdBy === viewerId) return true;
  return journal.judges.some(
    (entry) => entry.hackathonId === hackathonId && entry.judgeId === viewerId,
  );
}

/* -------------------------------------------------------------- hackathons */

export async function createHackathon(
  organizer: { id: string; name?: string | null },
  input: CreateHackathonInput,
): Promise<Hackathon> {
  const name = input.name.trim();
  if (name.length < 2) throw new Error("A hackathon needs a name.");
  // A code the user chose is theirs to keep (or collide with); a generated one
  // is disposable, so a collision regenerates it instead of failing.
  const chosenCode = normaliseJoinCode(input.code ?? "");
  const codeIsGenerated = !chosenCode;
  let code = chosenCode || generateJoinCode(name);
  const rubric = input.criteria?.length ? input.criteria : defaultCriteriaSet("project").criteria;
  const maxScore = clampMax(input.maxScore ?? defaultCriteriaSet("project").maxScore);

  const collision = (codeIsYours: boolean) => {
    if (codeIsYours) throw new Error(`The code ${code} is already in use.`);
    code = generateJoinCode(name);
  };

  return runPortal(
    canUseRemotePortal(organizer.id),
    async () => {
      const supabase = getSupabase();
      // The unique index is on `upper(code)`, so a rare generated collision is
      // retried with a fresh suffix rather than surfaced to the organizer.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const { data, error } = await supabase
          .from("hackathons")
          .insert({
            code,
            name,
            description: input.description ?? null,
            status: (input.status ?? "open") as HackathonStatusRow,
            starts_at: input.startsAt ?? null,
            ends_at: input.endsAt ?? null,
            criteria: rubric as never,
            max_score: maxScore,
            created_by: organizer.id,
          })
          .select("*")
          .single();
        if (error) {
          if ((error as { code?: string }).code === "23505") {
            collision(!codeIsGenerated);
            continue;
          }
          throw new Error(error.message);
        }
        if (!data) throw new Error("The hackathon was not created.");
        return toHackathon(data);
      }
      throw new Error("The code could not be generated. Try a different one.");
    },
    () => {
      const journal = readJournal();
      while (journal.hackathons.some((entry) => entry.code.toUpperCase() === code)) {
        collision(!codeIsGenerated);
      }
      const timestamp = nowIso();
      const hackathon: Hackathon = {
        id: newId(),
        code,
        name,
        description: input.description ?? null,
        status: input.status ?? "open",
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        criteria: rubric,
        maxScore,
        // A browser-local prototype has one judge identity; recording it here
        // keeps the same access rule as a signed-in organizer.
        createdBy: organizer.id || LOCAL_JUDGE_ID,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      journal.hackathons = [...journal.hackathons, hackathon];
      writeJournal(journal);
      return hackathon;
    },
  );
}

function clampMax(value: number): number {
  if (!Number.isFinite(value)) return 1000;
  return Math.min(10000, Math.max(10, Math.round(value)));
}

/** Every hackathon this viewer organizes or judges, with submission counts. */
export async function listJudgeHackathons(viewerId: string): Promise<HackathonSummary[]> {
  if (!viewerId) return [];

  return runPortal(
    canUseRemotePortal(viewerId),
    async () => {
      const supabase = getSupabase();
      const [{ data: owned, error: ownedError }, { data: assigned, error: assignedError }] =
        await Promise.all([
          supabase.from("hackathons").select("*").eq("created_by", viewerId),
          supabase.from("hackathon_judges").select("hackathon_id").eq("judge_id", viewerId),
        ]);
      if (ownedError) throw new Error(ownedError.message);
      if (assignedError) throw new Error(assignedError.message);

      const assignedIds = (assigned ?? []).map((row) => row.hackathon_id);
      let extra: HackathonRow[] = [];
      if (assignedIds.length > 0) {
        const { data, error } = await supabase.from("hackathons").select("*").in("id", assignedIds);
        if (error) throw new Error(error.message);
        extra = data ?? [];
      }

      const byId = new Map<string, HackathonRow>();
      for (const row of [...(owned ?? []), ...extra]) byId.set(row.id, row);
      const hackathons = [...byId.values()].map(toHackathon);
      if (hackathons.length === 0) return [];

      const { data: submissions, error: submissionsError } = await supabase
        .from("hackathon_submissions")
        .select("hackathon_id, status")
        .in(
          "hackathon_id",
          hackathons.map((hackathon) => hackathon.id),
        );
      if (submissionsError) throw new Error(submissionsError.message);

      return hackathons
        .map((hackathon) => summarise(hackathon, submissions ?? []))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    () => {
      const journal = readJournal();
      return journal.hackathons
        .filter((hackathon) => localCanJudge(journal, hackathon.id, viewerId))
        .map((hackathon) => summarise(hackathon, journal.submissions))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  );
}

function summarise(
  hackathon: Hackathon,
  submissions: {
    hackathon_id?: string | null;
    hackathonId?: string | null;
    status: SubmissionStatusRow | SubmissionStatus;
  }[],
): HackathonSummary {
  const mine = submissions.filter((row) => (row.hackathon_id ?? row.hackathonId) === hackathon.id);
  return {
    ...hackathon,
    submissionCount: mine.length,
    scoredCount: mine.filter((row) => row.status === "evaluated" || row.status === "finalized")
      .length,
  };
}

/**
 * Resolve a join code to its hackathon.
 *
 * Remote goes through `join_hackathon` (security definer), so a candidate can
 * join with a code without being able to list other events.
 */
export async function findHackathonByCode(
  code: string,
  viewerId: string | null,
): Promise<Hackathon | null> {
  const normalised = normaliseJoinCode(code);
  if (!normalised) return null;

  // The RPC works for signed-in users; guests read the local journal.
  return runPortal(
    canUseRemotePortal(viewerId),
    async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc("join_hackathon", { p_code: normalised });
      if (error) throw new Error(error.message);
      if (!data) return null;
      return toHackathon(data as HackathonRow);
    },
    () => {
      const journal = readJournal();
      return (
        journal.hackathons.find(
          (entry) => entry.code.toUpperCase() === normalised && entry.status !== "draft",
        ) ?? null
      );
    },
  );
}

/** Assign judges to a hackathon (organizer only). */
export async function setHackathonJudges(
  hackathonId: string,
  organizerId: string,
  judgeIds: string[],
): Promise<void> {
  const unique = [...new Set(judgeIds.filter(Boolean))];

  await runPortal(
    canUseRemotePortal(organizerId),
    async () => {
      const supabase = getSupabase();
      const { data: hackathon, error: readError } = await supabase
        .from("hackathons")
        .select("id, created_by")
        .eq("id", hackathonId)
        .maybeSingle();
      if (readError) throw new Error(readError.message);
      if (!hackathon) throw new Error("Hackathon not found.");
      if (hackathon.created_by !== organizerId) {
        throw new Error("Only the organizer can change the judging panel.");
      }

      const { error: deleteError } = await supabase
        .from("hackathon_judges")
        .delete()
        .eq("hackathon_id", hackathonId);
      if (deleteError) throw new Error(deleteError.message);

      if (unique.length === 0) return;
      const { error: insertError } = await supabase
        .from("hackathon_judges")
        .insert(unique.map((judgeId) => ({ hackathon_id: hackathonId, judge_id: judgeId })));
      if (insertError) throw new Error(insertError.message);
    },
    () => {
      const journal = readJournal();
      const hackathon = journal.hackathons.find((entry) => entry.id === hackathonId);
      if (!hackathon) throw new Error("Hackathon not found.");
      if (hackathon.createdBy !== organizerId) {
        throw new Error("Only the organizer can change the judging panel.");
      }
      journal.judges = [
        ...journal.judges.filter((entry) => entry.hackathonId !== hackathonId),
        ...unique.map((judgeId) => ({ hackathonId, judgeId })),
      ];
      writeJournal(journal);
    },
  );
}

export async function listHackathonJudges(
  hackathonId: string,
  viewerId: string,
): Promise<string[]> {
  return runPortal(
    canUseRemotePortal(viewerId),
    async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("hackathon_judges")
        .select("judge_id")
        .eq("hackathon_id", hackathonId);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => row.judge_id);
    },
    () => {
      const journal = readJournal();
      if (!localCanJudge(journal, hackathonId, viewerId)) return [];
      return journal.judges
        .filter((entry) => entry.hackathonId === hackathonId)
        .map((entry) => entry.judgeId);
    },
  );
}

/* -------------------------------------------------------------- submissions */

/**
 * Submit a project to a hackathon.
 *
 * Idempotent by construction: the database has
 * `unique (hackathon_id, candidate_id)`, and the local path updates the existing
 * row too. A refreshed page or a double-clicked button therefore updates one
 * submission instead of creating a second project record.
 */
export async function submitToHackathon(input: SubmitProjectInput): Promise<HackathonSubmission> {
  const teamName = input.teamName.trim();
  if (teamName.length < 2) throw new Error("A submission needs a project or team name.");
  if (!input.candidateId) throw new Error("Sign in to submit a project.");

  // The code is optional: without one the project is filed as unassigned and an
  // organizer attaches it to an event later.
  const hackathonId = input.hackathonId ?? null;

  const payload = {
    hackathon_id: hackathonId,
    candidate_id: input.candidateId,
    project_id: input.projectId ?? null,
    report_id: input.reportId ?? null,
    team_name: teamName,
    team_members: (input.teamMembers ?? []) as never,
    description: input.description ?? null,
    repo_url: input.repoUrl ?? null,
    website_url: input.websiteUrl ?? null,
    demo_url: input.demoUrl ?? null,
    deck_name: input.deckName ?? null,
    status: "submitted" as SubmissionStatusRow,
  };

  return runPortal(
    canUseRemotePortal(input.candidateId),
    async () => {
      const supabase = getSupabase();

      // Resume the row this candidate already has for this target instead of
      // leaning on ON CONFLICT. Two reasons:
      //   * an unassigned submission is covered by a *partial* unique index, and
      //     an upsert cannot use a partial index as its conflict target, so a
      //     retry used to fail with 23505 instead of updating the row;
      //   * an upsert rewrites `status`, and a candidate rewinding their own
      //     submission to 'submitted' is exactly what the lifecycle guard and the
      //     forward-only rule must refuse — the content is what a resubmit edits.
      const existingQuery = supabase
        .from("hackathon_submissions")
        .select("id")
        .eq("candidate_id", input.candidateId)
        .limit(1);
      const { data: existing, error: existingError } = hackathonId
        ? await existingQuery.eq("hackathon_id", hackathonId).maybeSingle()
        : await existingQuery.is("hackathon_id", null).maybeSingle();
      if (existingError) throw new Error(existingError.message, { cause: existingError });

      // `status` stays with the lifecycle: a resubmit edits the project, it does
      // not restart the judges' queue.
      const { status: _status, ...content } = payload;
      const { data, error } = existing
        ? await supabase
            .from("hackathon_submissions")
            .update(content)
            .eq("id", existing.id)
            .select("*")
            .single()
        : await supabase.from("hackathon_submissions").insert(payload).select("*").single();
      if (error) throw new Error(error.message, { cause: error });
      if (!data) throw new Error("The submission was not saved.");
      return toSubmission(data);
    },
    () => {
      const journal = readJournal();
      if (hackathonId) {
        const hackathon = journal.hackathons.find((entry) => entry.id === hackathonId);
        if (!hackathon) throw new Error("That hackathon code is not valid anymore.");
        if (hackathon.status === "complete") {
          throw new Error(`${hackathon.name} is closed for new submissions.`);
        }
      }

      const timestamp = nowIso();
      const existing = journal.submissions.find(
        (entry) =>
          (entry.hackathonId ?? null) === hackathonId && entry.candidateId === input.candidateId,
      );
      const submission: HackathonSubmission = existing
        ? {
            ...existing,
            projectId: payload.project_id ?? existing.projectId,
            reportId: payload.report_id ?? existing.reportId,
            teamName,
            teamMembers: input.teamMembers ?? existing.teamMembers,
            description: payload.description ?? existing.description,
            repoUrl: payload.repo_url ?? existing.repoUrl,
            websiteUrl: payload.website_url ?? existing.websiteUrl,
            demoUrl: payload.demo_url ?? existing.demoUrl,
            deckName: payload.deck_name ?? existing.deckName,
            status: existing.status,
            updatedAt: timestamp,
          }
        : {
            id: newId(),
            hackathonId,
            candidateId: input.candidateId,
            projectId: payload.project_id,
            reportId: payload.report_id,
            teamName,
            teamMembers: input.teamMembers ?? [],
            description: payload.description,
            repoUrl: payload.repo_url,
            websiteUrl: payload.website_url,
            demoUrl: payload.demo_url,
            deckName: payload.deck_name,
            status: "submitted",
            analysisRunId: null,
            resultPublished: false,
            publishedResult: null,
            publishedAt: null,
            submittedAt: timestamp,
            createdAt: timestamp,
            updatedAt: timestamp,
          };

      journal.submissions = existing
        ? journal.submissions.map((entry) => (entry.id === existing.id ? submission : entry))
        : [...journal.submissions, submission];
      writeJournal(journal);
      return submission;
    },
  );
}

/** A candidate's own submissions, with the hackathon they belong to. */
export async function listCandidateSubmissions(
  candidateId: string,
): Promise<CandidateSubmission[]> {
  if (!candidateId) return [];

  return runPortal(
    canUseRemotePortal(candidateId),
    async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("hackathon_submissions")
        .select("*")
        .eq("candidate_id", candidateId)
        .order("submitted_at", { ascending: false });
      if (error) throw new Error(error.message);
      const submissions = (data ?? []).map(toSubmission);
      if (submissions.length === 0) return [];

      const hackathonIds = submissions
        .map((submission) => submission.hackathonId)
        .filter((id): id is string => Boolean(id));
      const byId = new Map<string, Hackathon>();
      if (hackathonIds.length > 0) {
        const { data: hackathons, error: hackathonError } = await supabase
          .from("hackathons")
          .select("*")
          .in("id", hackathonIds);
        if (hackathonError) throw new Error(hackathonError.message);
        for (const row of hackathons ?? []) byId.set(row.id, toHackathon(row));
      }

      // An unassigned project still belongs in the candidate's history.
      return submissions.map((submission) => ({
        submission,
        hackathon: submission.hackathonId ? (byId.get(submission.hackathonId) ?? null) : null,
      }));
    },
    () => {
      const journal = readJournal();
      return journal.submissions
        .filter((submission) => submission.candidateId === candidateId)
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
        .map((submission) => ({
          submission,
          hackathon: submission.hackathonId
            ? (journal.hackathons.find((entry) => entry.id === submission.hackathonId) ?? null)
            : null,
        }));
    },
  );
}

/**
 * Submissions of every hackathon this judge may see.
 *
 * `hackathonId` narrows it to one event; the access check still applies, so a
 * hackathon the viewer does not own or judge returns an empty list rather than
 * someone else's projects.
 */
export async function listJudgeSubmissions(
  viewerId: string,
  hackathonId?: string | null,
): Promise<{ hackathon: Hackathon; submission: HackathonSubmission }[]> {
  if (!viewerId) return [];

  const hackathons = await listJudgeHackathons(viewerId);
  const allowed = hackathonId
    ? hackathons.filter((hackathon) => hackathon.id === hackathonId)
    : hackathons;
  if (allowed.length === 0) return [];

  const allowedIds = allowed.map((hackathon) => hackathon.id);
  const byId = new Map(allowed.map((hackathon) => [hackathon.id, hackathon]));

  return runPortal(
    canUseRemotePortal(viewerId),
    async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("hackathon_submissions")
        .select("*")
        .in("hackathon_id", allowedIds)
        .order("submitted_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).flatMap((row) => {
        const submission = toSubmission(row);
        const id = submission.hackathonId;
        const hackathon = id ? byId.get(id) : undefined;
        return hackathon ? [{ hackathon, submission }] : [];
      });
    },
    () => {
      const journal = readJournal();
      return journal.submissions
        .filter((submission) => submission.hackathonId !== null && byId.has(submission.hackathonId))
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
        .flatMap((submission) => {
          const id = submission.hackathonId;
          const hackathon = id ? byId.get(id) : undefined;
          return hackathon ? [{ hackathon, submission }] : [];
        });
    },
  );
}

/**
 * Projects submitted without a hackathon code.
 *
 * They sit in a shared intake pool until an organizer files them under an event:
 * the candidate submitted with a name, deck, repo and deployment URL, so the
 * project is complete — it just has no home yet.
 */
export async function listUnassignedSubmissions(viewerId: string): Promise<JudgeSubmission[]> {
  if (!viewerId) return [];

  return runPortal(
    canUseRemotePortal(viewerId),
    async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("hackathon_submissions")
        .select("*")
        .is("hackathon_id", null)
        .order("submitted_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => ({ submission: toSubmission(row), hackathon: null }));
    },
    () =>
      readJournal()
        .submissions.filter((submission) => !submission.hackathonId)
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
        .map((submission) => ({ submission, hackathon: null })),
  );
}

/**
 * File a submission under a hackathon — or, with `null`, back into the pool.
 *
 * This is the judge-side counterpart to the optional code: a team that did not
 * know the code is not lost, and a project entered under the wrong event can be
 * moved. Only an organizer/judge of the *target* event may do it, and a team
 * that already has a submission there is refused rather than duplicated.
 */
export async function assignSubmissionHackathon(
  submissionId: string,
  viewerId: string,
  hackathonId: string | null,
): Promise<JudgeSubmission | null> {
  if (!viewerId) return null;

  const visible = await getSubmissionForJudge(submissionId, viewerId);
  if (!visible) return null;

  if (!hackathonId) {
    if (!visible.submission.hackathonId) return visible;
    return patchSubmissionHackathon(submissionId, visible.submission.candidateId, null, viewerId);
  }

  const target = await listJudgeHackathons(viewerId);
  const allowed = target.find((entry) => entry.id === hackathonId);
  if (!allowed) throw new Error("You do not judge that hackathon.");
  if (visible.submission.hackathonId === hackathonId) return visible;

  return patchSubmissionHackathon(
    submissionId,
    visible.submission.candidateId,
    hackathonId,
    viewerId,
  );
}

/** Shared write for `assignSubmissionHackathon`, after the access checks. */
async function patchSubmissionHackathon(
  submissionId: string,
  candidateId: string,
  hackathonId: string | null,
  viewerId: string,
): Promise<JudgeSubmission | null> {
  return runPortal(
    canUseRemotePortal(viewerId),
    async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("hackathon_submissions")
        .update({ hackathon_id: hackathonId })
        .eq("id", submissionId)
        .select("*")
        .maybeSingle();
      if (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new Error("That team already has a submission in this hackathon.");
        }
        throw new Error(error.message);
      }
      if (!data) return null;
      const hackathon = hackathonId
        ? await supabase
            .from("hackathons")
            .select("*")
            .eq("id", hackathonId)
            .maybeSingle()
            .then(({ data: row }) => (row ? toHackathon(row) : null))
        : null;
      return { submission: toSubmission(data), hackathon };
    },
    () => {
      const journal = readJournal();
      const existing = journal.submissions.find((entry) => entry.id === submissionId);
      if (!existing || existing.candidateId !== candidateId) return null;
      if (hackathonId && !journal.hackathons.some((entry) => entry.id === hackathonId)) {
        throw new Error("That hackathon no longer exists.");
      }
      if (
        hackathonId &&
        journal.submissions.some(
          (entry) =>
            entry.id !== submissionId &&
            entry.hackathonId === hackathonId &&
            entry.candidateId === candidateId,
        )
      ) {
        throw new Error("That team already has a submission in this hackathon.");
      }

      const updated: HackathonSubmission = { ...existing, hackathonId, updatedAt: nowIso() };
      journal.submissions = journal.submissions.map((entry) =>
        entry.id === submissionId ? updated : entry,
      );
      writeJournal(journal);
      return {
        submission: updated,
        hackathon: hackathonId
          ? (journal.hackathons.find((entry) => entry.id === hackathonId) ?? null)
          : null,
      };
    },
  );
}

/** One submission, if this judge may see it. */
export async function getSubmissionForJudge(
  submissionId: string,
  viewerId: string,
): Promise<JudgeSubmission | null> {
  if (!viewerId) return null;

  return runPortal(
    canUseRemotePortal(viewerId),
    async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("hackathon_submissions")
        .select("*")
        .eq("id", submissionId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;

      // An unassigned submission lives in the shared intake pool: any judge may
      // open it in order to file it under one of their events.
      const hackathonId = (data.hackathon_id as string | null) ?? null;
      const { data: hackathon, error: hackathonError } = hackathonId
        ? await supabase.from("hackathons").select("*").eq("id", hackathonId).maybeSingle()
        : { data: null, error: null };
      if (hackathonError) throw new Error(hackathonError.message);
      if (hackathonId && !hackathon) return null;

      if (hackathonId) {
        // RLS already limits both reads; this keeps the contract explicit.
        const { data: allowed, error: allowedError } = await supabase.rpc("is_hackathon_judge", {
          hackathon: hackathonId,
          uid: viewerId,
        });
        if (allowedError) throw new Error(allowedError.message);
        if (!allowed) return null;
      }

      return {
        hackathon: hackathon ? toHackathon(hackathon) : null,
        submission: toSubmission(data),
      };
    },
    () => {
      const journal = readJournal();
      const submission = journal.submissions.find((entry) => entry.id === submissionId);
      if (!submission) return null;
      if (!submission.hackathonId) return { hackathon: null, submission };
      if (!localCanJudge(journal, submission.hackathonId, viewerId)) return null;
      const hackathon = journal.hackathons.find((entry) => entry.id === submission.hackathonId);
      return hackathon ? { hackathon, submission } : null;
    },
  );
}

/** One submission, if it belongs to this candidate. */
export async function getSubmissionForCandidate(
  submissionId: string,
  candidateId: string,
): Promise<JudgeSubmission | null> {
  if (!candidateId) return null;

  return runPortal(
    canUseRemotePortal(candidateId),
    async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("hackathon_submissions")
        .select("*")
        .eq("id", submissionId)
        .eq("candidate_id", candidateId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;

      const hackathonId = (data.hackathon_id as string | null) ?? null;
      const { data: hackathon, error: hackathonError } = hackathonId
        ? await supabase.from("hackathons").select("*").eq("id", hackathonId).maybeSingle()
        : { data: null, error: null };
      if (hackathonError) throw new Error(hackathonError.message);
      return {
        submission: toSubmission(data),
        hackathon: hackathon ? toHackathon(hackathon) : null,
      };
    },
    () => {
      const journal = readJournal();
      const submission = journal.submissions.find(
        (entry) => entry.id === submissionId && entry.candidateId === candidateId,
      );
      if (!submission) return null;
      const hackathon = submission.hackathonId
        ? (journal.hackathons.find((entry) => entry.id === submission.hackathonId) ?? null)
        : null;
      return { submission, hackathon };
    },
  );
}

/**
 * Move a submission forward in the lifecycle.
 *
 * Only forward: a later stage never rewinds when an older tab saves something
 * stale. `publishedAt`/`resultPublished` are judge-only and untouched here.
 */
export async function advanceSubmissionStatus(
  submissionId: string,
  viewerId: string,
  status: SubmissionStatus,
): Promise<HackathonSubmission | null> {
  if (!viewerId) return null;

  return runPortal(
    canUseRemotePortal(viewerId),
    async () => {
      const current = await getSubmissionForJudge(submissionId, viewerId);
      if (!current) return null;
      if (isStatusAtLeast(current.submission.status, status)) return current.submission;

      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("hackathon_submissions")
        .update({ status: status as SubmissionStatusRow })
        .eq("id", submissionId)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? toSubmission(data) : null;
    },
    () => {
      const journal = readJournal();
      const existing = journal.submissions.find((entry) => entry.id === submissionId);
      if (!existing) return null;
      // Scoring an unassigned project is what assigning it is for.
      if (!existing.hackathonId) return null;
      if (!localCanJudge(journal, existing.hackathonId, viewerId)) return null;
      if (isStatusAtLeast(existing.status, status)) return existing;

      const updated: HackathonSubmission = { ...existing, status, updatedAt: nowIso() };
      journal.submissions = journal.submissions.map((entry) =>
        entry.id === submissionId ? updated : entry,
      );
      writeJournal(journal);
      return updated;
    },
  );
}

/**
 * Candidate-side progress written by the analysis pipeline.
 *
 * A candidate can move their own submission to `processing` / `analyzed` and
 * record the evidence run id, but never past that: scoring stays with a judge.
 */
export async function syncSubmissionProgress(
  submissionId: string,
  candidateId: string,
  patch: {
    status?: Extract<SubmissionStatus, "processing" | "analyzed">;
    analysisRunId?: string | null;
  },
): Promise<HackathonSubmission | null> {
  if (!submissionId || !candidateId) return null;

  return runPortal(
    canUseRemotePortal(candidateId),
    async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("hackathon_submissions")
        .update({
          ...(patch.status ? { status: patch.status as SubmissionStatusRow } : {}),
          ...(patch.analysisRunId === undefined ? {} : { analysis_run_id: patch.analysisRunId }),
        })
        .eq("id", submissionId)
        .eq("candidate_id", candidateId)
        .select("*")
        .maybeSingle();
      // The raw error (SQLSTATE, detail, hint) is kept for the caller's log: a
      // rejected progress write is a database-policy problem, not a user mistake.
      if (error) throw new Error(error.message, { cause: error });
      return data ? toSubmission(data) : null;
    },
    () => {
      const journal = readJournal();
      const existing = journal.submissions.find(
        (entry) => entry.id === submissionId && entry.candidateId === candidateId,
      );
      if (!existing) return null;

      const nextStatus =
        patch.status && lifecycleStage(patch.status) > lifecycleStage(existing.status)
          ? patch.status
          : existing.status;
      const updated: HackathonSubmission = {
        ...existing,
        status: nextStatus,
        analysisRunId:
          patch.analysisRunId === undefined ? existing.analysisRunId : patch.analysisRunId,
        updatedAt: nowIso(),
      };
      journal.submissions = journal.submissions.map((entry) =>
        entry.id === submissionId ? updated : entry,
      );
      writeJournal(journal);
      return updated;
    },
  );
}

/**
 * Publish (or withdraw) a result for the candidate.
 *
 * Publishing writes only the numbers a candidate is entitled to see — total,
 * maximum, percentage and rank. Private notes, individual judge sheets and AI
 * reasoning stay in the judging tables and are never copied onto the submission.
 */
export async function setPublishedResult(
  submissionId: string,
  viewerId: string,
  result: Omit<PublishedResult, "publishedAt"> | null,
): Promise<HackathonSubmission | null> {
  if (!viewerId) return null;

  const published: PublishedResult | null = result ? { ...result, publishedAt: nowIso() } : null;

  return runPortal(
    canUseRemotePortal(viewerId),
    async () => {
      const current = await getSubmissionForJudge(submissionId, viewerId);
      if (!current) return null;

      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("hackathon_submissions")
        .update({
          result_published: Boolean(published),
          published_result: (published as never) ?? null,
          published_at: published?.publishedAt ?? null,
          status: (published ? "finalized" : current.submission.status) as SubmissionStatusRow,
        })
        .eq("id", submissionId)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? toSubmission(data) : null;
    },
    () => {
      const journal = readJournal();
      const existing = journal.submissions.find((entry) => entry.id === submissionId);
      if (!existing) return null;
      // Unassigned rows have no event, so there is no judge context to publish
      // a result from; they must be filed under a hackathon first.
      if (!existing.hackathonId) return null;
      if (!localCanJudge(journal, existing.hackathonId, viewerId)) return null;

      const updated: HackathonSubmission = {
        ...existing,
        resultPublished: Boolean(published),
        publishedResult: published,
        publishedAt: published?.publishedAt ?? null,
        status: published ? "finalized" : existing.status,
        updatedAt: nowIso(),
      };
      journal.submissions = journal.submissions.map((entry) =>
        entry.id === submissionId ? updated : entry,
      );
      writeJournal(journal);
      return updated;
    },
  );
}

export type { CriteriaSet };
