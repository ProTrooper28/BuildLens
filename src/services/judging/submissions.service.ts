import { normalizeReportData } from "@/lib/report-data";
import { DEMO_PROJECTS, DEMO_RESUMES } from "@/lib/evaluation/demo-cohort";
import type {
  EvaluationCategory,
  PresentationClaims,
  ProjectDetail,
  ResumeDetail,
  SubmissionDetail,
  SubmissionSummary,
} from "@/types/evaluation";
import { getGuestProject, listGuestReports } from "@/services/guest.service";
import { getProject } from "@/services/project.service";
import { getReport, listReports } from "@/services/report.service";
import {
  getSubmissionForJudge,
  listJudgeHackathons,
  listJudgeSubmissions,
  submissionStatusLabel,
} from "@/services/hackathon.service";
import { LOCAL_JUDGE_ID } from "@/services/judging/store";

/**
 * The submission pool the judging area ranks.
 *
 * Nothing here duplicates project/profile data: submissions are *views* over the
 * rows the product already has —
 *
 *   resumes  → reports of type "Developer" (the developer submission) + demo cohort
 *   projects → `hackathon_submissions` rows (the exact records the candidate
 *              portal writes) + legacy project rows
 *
 * The project pool is the shared hackathon model: a candidate submits to a
 * hackathon, and that submission row — with its team, links, deck and report —
 * is what a judge sees. A judge only ever reads the hackathons they own or are
 * assigned to, which is what keeps Hackathon A's projects out of Hackathon B.
 *
 * Ids are namespaced (`resume:<id>` / `project:<id>`) so the two pools can never
 * collide, and the id inside the namespace is the canonical submission id used by
 * the candidate portal, analysis, evidence, scoring and rankings.
 */

/** Who the judge side should read as: the signed-in user, or the local judge. */
function judgeViewerId(viewer: { userId: string | null; isGuest: boolean }): string | null {
  if (viewer.userId) return viewer.userId;
  return viewer.isGuest ? LOCAL_JUDGE_ID : null;
}

export function submissionId(category: EvaluationCategory, rawId: string): string {
  return `${category}:${rawId}`;
}

export function isDemoSubmission(id: string): boolean {
  return id.includes(":demo-");
}

/** Raw id behind a namespaced submission id (`resume:abc` → `abc`). */
export function rawSubmissionId(id: string): string | null {
  const index = id.indexOf(":");
  if (index === -1) return null;
  return id.slice(index + 1) || null;
}

function resumeSummary(resume: ResumeDetail): SubmissionSummary {
  const {
    email: _email,
    location: _location,
    headline: _headline,
    summary: _summary,
    experience,
    education,
    skills,
    projects,
    achievements,
    links,
    resumeDocument,
    ...summary
  } = resume;
  void [
    _email,
    _location,
    _headline,
    _summary,
    experience,
    education,
    skills,
    projects,
    achievements,
    links,
    resumeDocument,
  ];
  return summary;
}

function projectSummary(project: ProjectDetail): SubmissionSummary {
  const {
    team: _team,
    problemStatement: _problem,
    solution: _solution,
    technologies: _technologies,
    repoUrl: _repo,
    demoUrl: _demo,
    media: _media,
    teamMembers: _teamMembers,
    submitted: _submitted,
    ...summary
  } = project;
  void [_team, _problem, _solution, _technologies, _repo, _demo, _media, _teamMembers, _submitted];
  return summary;
}

/** Summaries for one category: workspace rows first, then the demo cohort. */
export async function fetchSubmissionSummaries(
  category: EvaluationCategory,
  viewer: { userId: string | null; isGuest: boolean },
): Promise<SubmissionSummary[]> {
  const demo =
    category === "resume" ? DEMO_RESUMES.map(resumeSummary) : DEMO_PROJECTS.map(projectSummary);

  if (category === "resume") {
    const fromReports: SubmissionSummary[] = [];

    if (viewer.userId) {
      try {
        const reports = await listReports(viewer.userId);
        for (const report of reports) {
          if (report.type !== "Developer") continue;
          fromReports.push({
            id: submissionId("resume", report.id),
            category: "resume",
            name: report.name,
            subtitle: "Developer submission",
            description: null,
            tags: [],
            yearsExperience: null,
            projectCategory: null,
            source: "workspace",
            createdAt: report.created_at,
          });
        }
      } catch {
        // A listing failure must not take the whole judging area down; the demo
        // cohort and the guest rows still render.
      }
    }

    if (viewer.isGuest) {
      for (const report of listGuestReports()) {
        if (report.type !== "Developer") continue;
        fromReports.push({
          id: submissionId("resume", report.id),
          category: "resume",
          name: report.name,
          subtitle: "Developer submission",
          description: null,
          tags: [],
          yearsExperience: null,
          projectCategory: null,
          source: "guest",
          createdAt: report.created_at,
        });
      }
    }

    return [...fromReports, ...demo];
  }

  const fromSubmissions: SubmissionSummary[] = [];
  const judgeId = judgeViewerId(viewer);
  let runsRealHackathons = false;

  if (judgeId) {
    try {
      runsRealHackathons = (await listJudgeHackathons(judgeId)).length > 0;
      for (const { submission, hackathon } of await listJudgeSubmissions(judgeId)) {
        fromSubmissions.push({
          id: submissionId("project", submission.id),
          category: "project",
          name: submission.teamName,
          // The hackathon is part of the row: a judge reviewing two events at
          // once can still tell which one a project belongs to.
          subtitle: `${hackathon.name} · ${hackathon.code}`,
          description: submission.description,
          tags: [],
          yearsExperience: null,
          projectCategory: submissionStatusLabel(submission.status),
          source: viewer.userId ? "workspace" : "guest",
          createdAt: submission.submittedAt,
        });
      }
    } catch {
      /* a listing failure must not take the whole judging area down */
    }
  }

  // The sample cohort is a stand-in for a workspace with no hackathons at all.
  // An organizer of a real event sees their event's submissions — including an
  // honest empty state — never sample projects mixed into their queue.
  return runsRealHackathons ? fromSubmissions : demo;
}

/* -------------------------------------------------------------------- detail */

/**
 * Full detail for one submission — the only call that reads a `report_data`
 * payload, and only for the submission the judge actually opened.
 */
export async function fetchSubmissionDetail(
  id: string,
  viewer: { userId: string | null; isGuest: boolean },
): Promise<SubmissionDetail | null> {
  if (id.startsWith("resume:")) {
    if (isDemoSubmission(id)) {
      return DEMO_RESUMES.find((resume) => resume.id === id) ?? null;
    }
    const rawId = rawSubmissionId(id);
    if (!rawId) return null;
    return resumeFromReport(rawId, viewer);
  }

  if (id.startsWith("project:")) {
    if (isDemoSubmission(id)) {
      return DEMO_PROJECTS.find((project) => project.id === id) ?? null;
    }
    const rawId = rawSubmissionId(id);
    if (!rawId) return null;
    // The shared submission record wins; a legacy workspace project is the
    // fallback for rows created before hackathons existed.
    const shared = await sharedProjectDetail(rawId, viewer);
    if (shared) return shared;
    return projectFromRow(rawId, viewer);
  }

  return null;
}

/**
 * A developer report re-read as a resume.
 *
 * The report is what the developer actually submitted, so the extraction is
 * literal: the report's summary, tech stack and highlights become the resume's
 * summary, skills and achievements. Sections the report never carried (work
 * history, education) stay empty instead of being invented — the detail view
 * labels that explicitly.
 */
async function resumeFromReport(
  reportId: string,
  viewer: { userId: string | null; isGuest: boolean },
): Promise<ResumeDetail | null> {
  const report = viewer.isGuest
    ? (listGuestReports().find((row) => row.id === reportId) ?? null)
    : await getReport(reportId).catch(() => null);
  if (!report) return null;

  const view = normalizeReportData(report.report_data);
  const skills = view.overview.techStack;
  const links: { label: string; url: string }[] = [
    { label: "Full report", url: `/report/${report.id}` },
  ];
  if (view.overview.repoUrl) links.push({ label: "Repository", url: view.overview.repoUrl });
  if (view.overview.websiteUrl) links.push({ label: "Website", url: view.overview.websiteUrl });

  return {
    id: submissionId("resume", report.id),
    category: "resume",
    source: viewer.isGuest ? "guest" : "workspace",
    name: report.name,
    subtitle: "Developer submission",
    description: view.executiveSummary ?? view.overview.summary,
    tags: skills,
    yearsExperience: null,
    projectCategory: null,
    createdAt: report.created_at,
    email: null,
    location: null,
    headline: null,
    summary: view.executiveSummary ?? view.overview.summary,
    experience: [],
    education: [],
    skills,
    projects: [],
    achievements: view.overview.highlights,
    links,
    resumeDocument: null,
  };
}

/**
 * A candidate's hackathon submission as the judge's project detail.
 *
 * Every field the judge reads comes from the submission the candidate sent (or
 * from the report attached to it) — nothing is re-entered by the judge and
 * nothing is invented. `null` means "this id is not a hackathon submission", so
 * the caller can fall back to a legacy project row.
 */
async function sharedProjectDetail(
  submissionRowId: string,
  viewer: { userId: string | null; isGuest: boolean },
): Promise<ProjectDetail | null> {
  const judgeId = judgeViewerId(viewer);
  if (!judgeId) return null;

  const row = await getSubmissionForJudge(submissionRowId, judgeId).catch(() => null);
  if (!row) return null;
  const { submission, hackathon } = row;

  let techStack: string[] = [];
  let summary: string | null = null;
  let solution: string | null = null;
  let presentationClaims: PresentationClaims | null = null;
  let presentationPages: NonNullable<ProjectDetail["presentationPages"]> | null = null;

  // The deck/report the candidate attached. Judges may read it through the
  // submission policy added in 0007; guests read their own browser journal.
  const report = submission.reportId
    ? await getReport(submission.reportId).catch(() => null)
    : viewer.isGuest
      ? (listGuestReports().find((entry) => entry.id === submission.reportId) ?? null)
      : null;

  const reportData = report
    ? normalizeReportData(report.report_data)
    : submission.projectId && viewer.isGuest
      ? (() => {
          const linked = listGuestReports().find(
            (entry) => entry.project_id === submission.projectId,
          );
          return linked ? normalizeReportData(linked.report_data) : null;
        })()
      : null;

  if (reportData) {
    techStack = reportData.overview.techStack;
    summary = reportData.executiveSummary ?? reportData.overview.summary;
    solution = reportData.architecture.summary;
    presentationClaims = deckClaims(reportData.documentAnalysis?.claims ?? null);
    presentationPages = deckPages(reportData.documentAnalysis?.pages ?? null);
  }

  const statusText = submissionStatusLabel(submission.status);
  const media: ProjectDetail["media"] = [];
  if (submission.deckName) {
    media.push({ label: submission.deckName, url: null, kind: "document" });
  }
  if (submission.demoUrl) {
    media.push({ label: "Demo video", url: submission.demoUrl, kind: "video" });
  }

  return {
    id: submissionId("project", submission.id),
    category: "project",
    source: viewer.userId ? "workspace" : "guest",
    name: submission.teamName,
    subtitle: `${hackathon.name} · ${hackathon.code}`,
    description: submission.description,
    tags: techStack,
    yearsExperience: null,
    projectCategory: statusText,
    createdAt: submission.submittedAt,
    team: submission.teamName,
    problemStatement: null,
    solution,
    technologies: techStack,
    repoUrl: submission.repoUrl,
    demoUrl: submission.websiteUrl,
    media,
    teamMembers: submission.teamMembers.map((name) => ({ name, role: null })),
    submitted: [
      { label: "Hackathon", value: `${hackathon.name} (${hackathon.code})` },
      { label: "Submitted", value: new Date(submission.submittedAt).toLocaleDateString() },
      { label: "Status", value: statusText },
      { label: "Report", value: summary ? "Attached" : "None attached" },
    ],
    presentationClaims,
    presentationPages,
    sharedSubmission: {
      hackathonId: hackathon.id,
      hackathonName: hackathon.name,
      hackathonCode: hackathon.code,
      status: submission.status,
      resultPublished: submission.resultPublished,
      publishedResult: submission.publishedResult
        ? {
            total: submission.publishedResult.total,
            maxScore: submission.publishedResult.maxScore,
            rank: submission.publishedResult.rank,
          }
        : null,
    },
  };
}

/** A projects row (plus its linked report, when there is one) as a submission. */
async function projectFromRow(
  projectId: string,
  viewer: { userId: string | null; isGuest: boolean },
): Promise<ProjectDetail | null> {
  const project = viewer.isGuest
    ? (() => {
        const guestProject = getGuestProject(projectId);
        return guestProject
          ? { ...guestProject, user_id: "", status: guestProject.status as string }
          : null;
      })()
    : await getProject(projectId).catch(() => null);
  if (!project) return null;

  let techStack: string[] = [];
  let summary: string | null = null;
  let solution: string | null = null;
  let presentationClaims: PresentationClaims | null = null;
  let presentationPages: NonNullable<ProjectDetail["presentationPages"]> | null = null;

  if (viewer.userId) {
    try {
      const reports = await listReports(viewer.userId);
      const linked = reports.find((report) => report.project_id === projectId);
      if (linked) {
        const full = await getReport(linked.id).catch(() => null);
        if (full) {
          const view = normalizeReportData(full.report_data);
          techStack = view.overview.techStack;
          summary = view.executiveSummary ?? view.overview.summary;
          solution = view.architecture.summary;
          presentationClaims = deckClaims(view.documentAnalysis?.claims ?? null);
          presentationPages = deckPages(view.documentAnalysis?.pages ?? null);
        }
      }
    } catch {
      /* detail still renders from the project row alone */
    }
  }

  // Guest submissions store their report in this browser, not in Supabase.
  if (viewer.isGuest && presentationClaims === null) {
    const linked = listGuestReports().find((report) => report.project_id === projectId);
    if (linked) {
      const view = normalizeReportData(linked.report_data);
      techStack = techStack.length > 0 ? techStack : view.overview.techStack;
      summary = summary ?? view.executiveSummary ?? view.overview.summary;
      solution = solution ?? view.architecture.summary;
      presentationClaims = deckClaims(view.documentAnalysis?.claims ?? null);
      presentationPages = deckPages(view.documentAnalysis?.pages ?? null);
    }
  }

  const statusLabel: Record<string, string> = {
    draft: "Draft",
    in_review: "In review",
    completed: "Completed",
  };

  return {
    id: submissionId("project", project.id),
    category: "project",
    source: viewer.isGuest ? "guest" : "workspace",
    name: project.name,
    subtitle: null,
    description: project.description,
    tags: techStack,
    yearsExperience: null,
    projectCategory: statusLabel[String(project.status)] ?? null,
    createdAt: project.created_at,
    team: null,
    problemStatement: null,
    solution,
    technologies: techStack,
    repoUrl: project.repo_url,
    demoUrl: project.website_url,
    // Submissions carry no media rows yet, so none are fabricated.
    media: [],
    teamMembers: [],
    submitted: [
      { label: "Submitted", value: new Date(project.created_at).toLocaleDateString() },
      { label: "Status", value: statusLabel[String(project.status)] ?? "Unknown" },
      { label: "Report", value: summary ? "Attached" : "None attached" },
    ],
    presentationClaims,
    presentationPages,
  };
}

/**
 * Per-page deck text → the short previews claims are cited against ("PDF page
 * 7"). Empty when the report predates page text or the deck was image-only.
 */
function deckPages(
  pages: { page: number; text: string | null }[] | null | undefined,
): NonNullable<ProjectDetail["presentationPages"]> | null {
  const withText = (pages ?? [])
    .filter((page) => (page.text ?? "").trim().length > 0)
    .map((page) => ({ page: page.page, text: (page.text ?? "").trim().slice(0, 2000) }));
  return withText.length > 0 ? withText.slice(0, 80) : null;
}

/** Report deck claims → the judge-facing claim shape (empty = no deck claims). */
function deckClaims(
  claims: {
    summary: string | null;
    problem: string[];
    solution: string[];
    features: string[];
    technology: string[];
    impact: string[];
    method: string | null;
  } | null,
): PresentationClaims | null {
  if (!claims) return null;
  return {
    summary: claims.summary,
    problem: claims.problem,
    solution: claims.solution,
    features: claims.features,
    technology: claims.technology,
    impact: claims.impact,
    method: claims.method === "llm" ? "llm" : "heuristic",
  };
}
