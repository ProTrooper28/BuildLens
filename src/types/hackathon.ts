import type { ArtPreset } from "@/components/ui/glass-folder-cards";
import type { CriteriaSet, CriterionScore, EvaluationRecommendation } from "@/types/evaluation";

/**
 * Hackathon archives — the judge's filing system.
 *
 * A hackathon is identified by its **code** (`HACK-001`), and that code is the
 * only scope that matters: projects, resumes, criteria and scores all carry it,
 * and every read in `lib/hackathons/store` filters on it. Two archives never
 * share a row, which is what keeps HACK-001's rankings out of HACK-002.
 *
 * These interfaces are the seam a real backend replaces: swap
 * `lib/hackathons/data.ts` for a fetch and the screens are unchanged. No AI
 * score exists anywhere in the model — the AI ranking lane is a placeholder
 * until a provider is connected (see services/judging/ai-evaluation.service).
 */

/** Normalised form of an archive code, e.g. `HACK-001`. */
export type HackathonCode = string;

export type JudgingState = "open" | "scoring" | "complete";

export interface HackathonArchive {
  code: HackathonCode;
  name: string;
  /** Track / edition line under the name. */
  subtitle: string;
  dates: string;
  location: string;
  judgingState: JudgingState;
  projectCount: number;
  resumeCount: number;
  /** Projects that already carry at least one submitted score. */
  scoredCount: number;
  /** Artwork preset for the folder's back panel. */
  art: ArtPreset;
  /** Milk glass or smoked glass — matched to the room the archive lives in. */
  tone: "light" | "dark";
  /** Folder artwork arrangement. */
  seed: number;
  /** Accent used by the workspace's active states. */
  accent: string;
}

export interface HackathonProject {
  id: string;
  hackathonCode: HackathonCode;
  name: string;
  team: string;
  description: string;
  technologies: string[];
  status: "submitted" | "in_review" | "scored";
  /**
   * Deterministic sample score (0–1) for the demo cohort. Used only when the
   * archive ships pre-scored and the judge has not scored it themselves —
   * never presented as the judge's own work.
   */
  samplePercent: number | null;
}

export interface HackathonResume {
  id: string;
  hackathonCode: HackathonCode;
  candidate: string;
  role: string;
  headline: string;
  skills: string[];
  yearsExperience: number;
  education: string;
  summary: string;
  /** Same contract as `HackathonProject.samplePercent`. */
  samplePercent: number | null;
}

/** One judge's scoring of one project inside one archive. */
export interface HackathonScore {
  id: string;
  hackathonCode: HackathonCode;
  projectId: string;
  judgeId: string;
  judgeName: string | null;
  scores: CriterionScore[];
  note: string | null;
  recommendation: EvaluationRecommendation;
  /** Rubric this score was entered against (edits never rewrite old scores). */
  criteriaSnapshot: { maxScore: number; criteria: CriteriaSet["criteria"] };
  /** Draft or submitted — drafts never enter the ranking. */
  status: "in_progress" | "evaluated";
  submittedAt: string | null;
  updatedAt: string;
}

/** A project plus its judged result — the workspace list/leaderboard row. */
export interface RankedProject {
  project: HackathonProject;
  rank: number | null;
  total: number | null;
  maxScore: number;
  percent: number | null;
  /** Where the number came from. */
  source: "you" | "sample" | null;
  evaluations: number;
}

export interface RankedResume {
  resume: HackathonResume;
  rank: number | null;
  percent: number | null;
  source: "sample" | null;
}

/* ==========================================================================
 * The shared portal model
 *
 * The interfaces above describe the judge's demo archives. Everything below is
 * the real, database-backed model (supabase/migrations/0007_hackathon_portal.sql)
 * that both portals read and write: one hackathon row, one submission row per
 * candidate, one canonical submission id.
 * ========================================================================== */

/** Lifecycle both portals display, in the order it happens. */
export type SubmissionStatus =
  "submitted" | "processing" | "analyzed" | "under_review" | "evaluated" | "finalized";

export type HackathonStatus = "draft" | "open" | "judging" | "complete";

/** One hackathon, as both portals see it. */
export interface Hackathon {
  id: string;
  /** The code candidates type to join. Unique, case-insensitive. */
  code: string;
  name: string;
  description: string | null;
  status: HackathonStatus;
  startsAt: string | null;
  endsAt: string | null;
  /** This event's rubric — the judge scores against it. */
  criteria: CriteriaSet["criteria"];
  maxScore: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** The result a judge publishes, and the only score a candidate may see. */
export interface PublishedResult {
  total: number;
  maxScore: number;
  percent: number;
  rank: number | null;
  publishedAt: string;
}

/**
 * One candidate's submission for one hackathon.
 *
 * `id` is the canonical project id: the candidate portal, the judge portal, the
 * analysis run, the evidence bundle, scoring and rankings all use this value.
 */
export interface HackathonSubmission {
  id: string;
  /**
   * The hackathon this submission is filed under, or `null` while it is still
   * unassigned: the candidate did not know a code, and an organizer attaches the
   * project to an event later from the judge portal's intake list.
   */
  hackathonId: string | null;
  candidateId: string;
  projectId: string | null;
  reportId: string | null;
  teamName: string;
  teamMembers: string[];
  description: string | null;
  repoUrl: string | null;
  websiteUrl: string | null;
  demoUrl: string | null;
  deckName: string | null;
  status: SubmissionStatus;
  analysisRunId: string | null;
  resultPublished: boolean;
  publishedResult: PublishedResult | null;
  publishedAt: string | null;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A submission joined with its hackathon — what the portals list.
 *
 * `hackathon` is `null` for an unassigned submission (a project submitted
 * without a code) until an organizer assigns it.
 */
export interface CandidateSubmission {
  submission: HackathonSubmission;
  hackathon: Hackathon | null;
}

/** A judge-side submission row; same shape, named for the judge portal. */
export type JudgeSubmission = CandidateSubmission;

/** A hackathon plus how much has been submitted to it (organizer view). */
export interface HackathonSummary extends Hackathon {
  submissionCount: number;
  scoredCount: number;
}

export interface CreateHackathonInput {
  name: string;
  description?: string | null;
  /** Generated from the name when omitted. */
  code?: string | undefined;
  status?: HackathonStatus;
  startsAt?: string | null;
  endsAt?: string | null;
  criteria?: CriteriaSet["criteria"];
  maxScore?: number;
}

/** What a candidate sends when they submit a project for judging. */
export interface SubmitProjectInput {
  /** Omitted or `null` files the project as unassigned, to be sorted later. */
  hackathonId?: string | null;
  candidateId: string;
  teamName: string;
  teamMembers?: string[];
  description?: string | null;
  repoUrl?: string | null;
  websiteUrl?: string | null;
  demoUrl?: string | null;
  deckName?: string | null;
  projectId?: string | null;
  reportId?: string | null;
}
