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
import { getGuestProject, listGuestProjects, listGuestReports } from "@/services/guest.service";
import { getProject, listProjects } from "@/services/project.service";
import { getReport, listReports } from "@/services/report.service";

/**
 * The submission pool the judging area ranks.
 *
 * Nothing here duplicates project/profile data: submissions are *views* over the
 * rows the product already has —
 *
 *   resumes  → reports of type "Developer" (the developer submission) + demo cohort
 *   projects → projects rows (plus their linked report for tech/media)       + demo cohort
 *
 * Ids are namespaced (`resume:<id>` / `project:<id>`) so the two pools can never
 * collide, and every summary is derived from already-loaded list rows: the
 * judging pages never transfer a full `report_data` payload until a judge opens
 * one submission.
 */

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

  const fromProjects: SubmissionSummary[] = [];

  if (viewer.userId) {
    try {
      for (const project of await listProjects(viewer.userId)) {
        fromProjects.push({
          id: submissionId("project", project.id),
          category: "project",
          name: project.name,
          subtitle: null,
          description: project.description,
          tags: [],
          yearsExperience: null,
          projectCategory: project.status === "draft" ? "Draft" : "Submitted",
          source: "workspace",
          createdAt: project.created_at,
        });
      }
    } catch {
      /* see the resume branch */
    }
  }

  if (viewer.isGuest) {
    for (const project of listGuestProjects()) {
      fromProjects.push({
        id: submissionId("project", project.id),
        category: "project",
        name: project.name,
        subtitle: null,
        description: project.description,
        tags: [],
        yearsExperience: null,
        projectCategory: "Draft",
        source: "guest",
        createdAt: project.created_at,
      });
    }
  }

  return [...fromProjects, ...demo];
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
