/**
 * Judge evaluation domain model.
 *
 * Two evaluation categories sit on top of the existing data model:
 *
 *  - `resume`  — developer submissions (candidate + resume material)
 *  - `project` — project submissions (hackathon / portfolio projects)
 *
 * Everything a judge produces is described here, and nothing in the UI talks to
 * a table directly: the services normalise Supabase rows and the browser-local
 * store into these types, so the screens behave identically whether the judge is
 * signed in or working offline in guest mode.
 *
 * AI fields exist from day one but are never fabricated — `AiEvaluation` is
 * `unavailable` until a provider is registered (see services/judging/ai-evaluation.service).
 */

export type EvaluationCategory = "resume" | "project";

/**
 * Submission-level evaluation state, derived from the evaluations attached to it
 * (never stored as a free-floating flag that could drift from the scores).
 */
export type EvaluationStatus = "not_evaluated" | "in_progress" | "evaluated" | "reviewed";

/** State of one judge's own evaluation record. */
export type EvaluationRecordStatus = "in_progress" | "evaluated" | "reviewed";

export type EvaluationRecommendation = "strong_yes" | "yes" | "maybe" | "no" | "strong_no" | null;

/** One scoring criterion inside a category's criteria set. */
export interface EvaluationCriterion {
  /** Stable key, also used as the score key (`innovation`, `ux`, …). */
  id: string;
  name: string;
  description: string;
  /** Raw points for this criterion, before proportional scaling to the max score. */
  maxPoints: number;
  /**
   * Optional relative weight. `1` is neutral; a higher value shifts points toward
   * this criterion. The engine re-normalises so the set always totals `maxScore`.
   */
  weight: number;
}

/**
 * A category's scoring configuration: the maximum score and the criteria.
 *
 * `maxScore` is the single source of truth for the scale (100 / 500 / 1000 /
 * 2000 / custom). Criterion points are rescaled from it, so nothing downstream
 * hard-codes 1000.
 */
export interface CriteriaSet {
  category: EvaluationCategory;
  maxScore: number;
  criteria: EvaluationCriterion[];
  updatedAt: string;
}

/** A judge's score for one criterion. */
export interface CriterionScore {
  criterionId: string;
  /** Points awarded within the criterion's scaled maximum. `null` = untouched. */
  awarded: number | null;
  note: string | null;
}

/**
 * Private judge notes.
 *
 * Structurally separate from the numeric scores, and carrying its own
 * visibility so the same entity can later expose selected notes as candidate
 * feedback without ever publishing the private ones.
 */
export interface JudgeNote {
  body: string;
  visibility: "private" | "feedback";
  updatedAt: string;
}

/** One judge's evaluation of one submission. */
/* ----------------------------------------------------------- judge copilot */

export type JudgeQuestionCategory =
  "technical" | "functionality" | "security" | "performance" | "claim" | "product";

export type JudgeQuestionPriority = "high" | "medium" | "low";

export type JudgeQuestionStatus = "pending" | "asked" | "answered";

/**
 * One question for the team. Generated questions quote the evidence they came
 * from; judge-written ones are stored beside them with the same status.
 */
export interface JudgeQuestion {
  id: string;
  category: JudgeQuestionCategory;
  question: string;
  /** Why this is worth asking — shown to the judge only. */
  why: string;
  /** The observation, claim or measurement behind the question. */
  evidence: string;
  priority: JudgeQuestionPriority;
  source: "evidence" | "judge";
  status: JudgeQuestionStatus;
  note: string | null;
}

/** The mentor's structured review — persisted with the evaluation. */
export interface JudgeReview {
  /** Free-text overall assessment. */
  assessment: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  concerns: string[];
  /** The mentor's decision; `null` until they choose one. */
  recommendation: EvaluationRecommendation;
  updatedAt: string;
}

/** One candidate-safe improvement: problem → why it matters → what to do. */
export interface ImprovementSuggestion {
  id: string;
  /** Documentation, Performance, Security, Claim clarity, Deployment, … */
  area: string;
  problem: string;
  why: string;
  recommendation: string;
}

export interface JudgeEvaluation {
  id: string;
  submissionId: string;
  category: EvaluationCategory;
  judgeId: string;
  judgeName: string | null;
  status: EvaluationRecordStatus;
  scores: CriterionScore[];
  notes: JudgeNote | null;
  /**
   * Questions asked of the team (generated + judge-written), with their state.
   * Optional so records written before the copilot existed stay valid.
   */
  questions?: JudgeQuestion[];
  /** The mentor's structured review, or null before they save one. */
  review?: JudgeReview | null;
  recommendation: EvaluationRecommendation;
  /**
   * The criteria the judge scored against. Snapshotted so an ADministrator
   * editing the rubric later never silently changes an existing score.
   */
  criteriaSnapshot: { maxScore: number; criteria: EvaluationCriterion[] } | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
}

/**
 * AI evaluation envelope — architecture only.
 *
 * A future provider (OpenAI, another model, a custom or local model) fills this
 * in; the UI already renders it, so plugging a provider in needs no screen
 * changes. `unavailable` is the only state the app can currently produce.
 */
export interface AiEvaluation {
  status: "unavailable" | "pending" | "ready" | "failed";
  score: number | null;
  criteriaScores: CriterionScore[] | null;
  reasoning: string | null;
  /** 0–1. */
  confidence: number | null;
  model: string | null;
  evaluatedAt: string | null;
}

/** Rolled-up judging result for one submission — what the leaderboard ranks. */
export interface SubmissionAggregate {
  submissionId: string;
  category: EvaluationCategory;
  status: EvaluationStatus;
  /** Average of submitted judge scores, in the criteria set's scale. */
  judgeScore: number | null;
  /** Total submitted evaluations. */
  evaluations: number;
  /** Draft evaluations that have not been submitted yet. */
  drafts: number;
  /** Every submitted score, for distribution displays. */
  distribution: number[];
  ai: AiEvaluation;
  /** Scoring weights used for `finalScore`. */
  weights: FinalScoreWeights;
  /**
   * Judge-only while AI weighting is inactive (`aiScore === null`), then the
   * weighted blend. Never invented when there is no score.
   */
  finalScore: number | null;
}

/**
 * How judge and AI scores combine. `ai` stays `0` until AI evaluation actually
 * exists, so no ranking can be distorted by a weight for a score nobody has.
 */
export interface FinalScoreWeights {
  judge: number;
  ai: number;
}

/** Submission source, so demo material is never mistaken for a real cohort. */
export type SubmissionSource = "workspace" | "guest" | "demo";

/**
 * Lightweight submission row — what a list renders.
 *
 * Detail (resume sections, project media, full team) is deliberately absent and
 * fetched only when a judge opens the submission.
 */
export interface SubmissionSummary {
  /** Namespaced id: `<category>:<raw id>` so the two pools can never collide. */
  id: string;
  category: EvaluationCategory;
  name: string;
  /** Role for resumes, team/developer for projects. */
  subtitle: string | null;
  description: string | null;
  /** Resume: top skills. Project: technologies. */
  tags: string[];
  /** Resume: years of experience. Project: null. */
  yearsExperience: number | null;
  /** Project: category label. Resume: null. */
  projectCategory: string | null;
  source: SubmissionSource;
  createdAt: string | null;
}

/* ------------------------------------------------------------------ details */

export interface ResumeExperience {
  title: string;
  organization: string | null;
  period: string | null;
  summary: string | null;
  highlights: string[];
}

export interface ResumeEducation {
  qualification: string;
  institution: string | null;
  period: string | null;
  detail: string | null;
}

export interface ResumeProject {
  name: string;
  summary: string | null;
  technologies: string[];
}

export interface ResumeDetail extends SubmissionSummary {
  category: "resume";
  email: string | null;
  location: string | null;
  headline: string | null;
  summary: string | null;
  experience: ResumeExperience[];
  education: ResumeEducation[];
  skills: string[];
  projects: ResumeProject[];
  achievements: string[];
  links: { label: string; url: string }[];
  /** Original document/attachment, when the submission carried one. */
  resumeDocument: { name: string; url: string | null } | null;
}

export interface ProjectTeamMember {
  name: string;
  role: string | null;
}

/**
 * Claims the team made in their submitted deck (PPT/PDF).
 *
 * Carried on the project detail so the evidence run can compare them with the
 * repository and deployed site. They are claims, never facts — every consumer
 * labels them that way.
 */
export interface PresentationClaims {
  summary?: string | null;
  problem?: string[];
  solution?: string[];
  features?: string[];
  technology?: string[];
  impact?: string[];
  method?: "heuristic" | "llm";
}

export interface ProjectDetail extends SubmissionSummary {
  category: "project";
  team: string | null;
  problemStatement: string | null;
  solution: string | null;
  technologies: string[];
  repoUrl: string | null;
  demoUrl: string | null;
  media: { label: string; url: string | null; kind: "image" | "video" | "document" }[];
  teamMembers: ProjectTeamMember[];
  submitted: { label: string; value: string }[];
  /** Deck claims extracted from the attached report, when it carried a deck. */
  presentationClaims: PresentationClaims | null;
  /** Short per-page text previews, used to cite the slide a claim came from. */
  presentationPages?: { page: number; text: string }[] | null;
  /**
   * Present when this project came from the shared hackathon portal.
   *
   * The judge page uses it to show the submission's lifecycle and to publish the
   * result the candidate will see. Declared structurally so the evaluation types
   * do not import the hackathon model.
   */
  sharedSubmission?: {
    hackathonId: string;
    hackathonName: string;
    hackathonCode: string;
    status: string;
    resultPublished: boolean;
    publishedResult: { total: number; maxScore: number; rank: number | null } | null;
  } | null;
}

export type SubmissionDetail = ResumeDetail | ProjectDetail;

/* --------------------------------------------------------------- list query */

export type SubmissionStatusFilter =
  | "all"
  | "evaluated"
  | "not_evaluated"
  | "in_progress"
  | "reviewed"
  /** The current judge's own queue: nothing filed yet, or still a draft. */
  | "to_score";

export type SubmissionSort = "rank" | "score_desc" | "score_asc" | "name" | "newest" | "status";

export interface SubmissionFilter {
  query?: string;
  status?: SubmissionStatusFilter;
  sort?: SubmissionSort;
  /** Resume role filter. */
  role?: string | null;
  /** Resume minimum years of experience. */
  minYears?: number | null;
  /** Project technology filter. */
  technology?: string | null;
  /** Project category filter. */
  projectCategory?: string | null;
}

/** A submission plus its judging result — the list/leaderboard row. */
export interface RankedSubmission {
  submission: SubmissionSummary;
  aggregate: SubmissionAggregate;
  rank: number | null;
  /** Present only for the current judge. */
  myScore: number | null;
  myStatus: EvaluationRecordStatus | null;
}
