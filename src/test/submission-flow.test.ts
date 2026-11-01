import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createProjectSubmission,
  describeSubmissionFailure,
  guestSubmissionStore,
  SubmissionError,
  type StoredProject,
  type StoredReport,
  type SubmissionDraft,
  type SubmissionStore,
} from "@/services/submission.service";
import {
  createHackathon,
  listCandidateSubmissions,
  listJudgeSubmissions,
} from "@/services/hackathon.service";
import { getGuestProject, listGuestReports } from "@/services/guest.service";
import type { Hackathon } from "@/types/hackathon";

/**
 * The submission flow, end to end.
 *
 * These cover the rules the P0 broke: a submission is only reported as stored
 * when every required row exists, a retry reuses the row instead of stacking a
 * second project, a failure removes what the attempt created, and a rejected
 * progress write never turns a stored submission into a failure.
 *
 * No Supabase is configured in this environment, so the portal writes run on the
 * local journal (the same path an un-migrated project or a guest uses) while the
 * persistence adapter is injected — which is where the failures are simulated.
 */

const progress = vi.hoisted(() => ({ fail: false }));

vi.mock("@/services/hackathon.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/hackathon.service")>();
  return {
    ...actual,
    syncSubmissionProgress: (...args: Parameters<typeof actual.syncSubmissionProgress>) =>
      progress.fail
        ? Promise.reject(
            new Error("Only a judge of this hackathon may change a submission status."),
          )
        : actual.syncSubmissionProgress(...args),
  };
});

const CANDIDATE = "candidate-1";

function draft(overrides: Partial<SubmissionDraft> = {}): SubmissionDraft {
  return {
    candidateId: CANDIDATE,
    hackathon: null,
    projectName: "Aurora — Realtime Analytics",
    teamName: "Team Aurora",
    teamMembers: ["Ada Lovelace", "Grace Hopper"],
    description: "Realtime dashboards for warehouse telemetry.",
    repoUrl: "https://github.com/team/aurora",
    websiteUrl: "https://aurora.example.com",
    deckName: "aurora.pptx",
    reportData: { repo_url: "https://github.com/team/aurora", attachments: [] },
    ...overrides,
  };
}

function phantomHackathon(): Hackathon {
  // A code that resolved on the client but has no row in the journal/database:
  // filing the submission under it must fail, not invent a hackathon.
  return {
    id: "hackathon-that-does-not-exist",
    code: "DEMO26",
    name: "Demo Hackathon 2026",
    description: null,
    status: "open",
    startsAt: null,
    endsAt: null,
    criteria: [],
    maxScore: 1000,
    createdBy: "organizer-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** A store that records what was created so cleanup can be asserted. */
function memoryStore(overrides: Partial<SubmissionStore> = {}) {
  const projects: StoredProject[] = [];
  const reports: StoredReport[] = [];
  const discarded: { projectId: string | null; reportId: string | null }[] = [];
  let sequence = 0;

  const store: SubmissionStore = {
    kind: "browser",
    async createProject(input) {
      const project: StoredProject = {
        id: `project-${++sequence}`,
        name: input.projectName,
        repoUrl: input.repoUrl,
        websiteUrl: input.websiteUrl,
        description: input.description,
      };
      projects.push(project);
      return project;
    },
    async createReport() {
      const report: StoredReport = {
        id: `report-${++sequence}`,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      reports.push(report);
      return report;
    },
    async discard(created) {
      discarded.push(created);
    },
    ...overrides,
  };

  return { store, projects, reports, discarded };
}

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.localStorage.clear();
  progress.fail = false;
  errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("submission creation", () => {
  it("stores the project, its report and the submission, then returns the real ids", async () => {
    const hackathon = await createHackathon({ id: "organizer-1" }, { name: "Demo Hackathon 2026" });

    const outcome = await createProjectSubmission(guestSubmissionStore(), draft({ hackathon }), {
      fileSubmission: true,
    });

    expect(outcome.projectId).toBeTruthy();
    expect(outcome.reportId).toBeTruthy();
    expect(outcome.submissionId).toBeTruthy();
    expect(outcome.hackathon?.id).toBe(hackathon.id);
    expect(getGuestProject(outcome.projectId)?.name).toBe("Aurora — Realtime Analytics");
    expect(listGuestReports().map((report) => report.id)).toContain(outcome.reportId);

    const mine = await listCandidateSubmissions(CANDIDATE);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.submission.id).toBe(outcome.submissionId);
    expect(mine[0]?.submission.hackathonId).toBe(hackathon.id);
    expect(mine[0]?.submission.projectId).toBe(outcome.projectId);
    expect(mine[0]?.submission.reportId).toBe(outcome.reportId);

    // The judge portal reads the same row — not a second, judge-only project.
    const judged = await listJudgeSubmissions("organizer-1", hackathon.id);
    expect(judged.map((row) => row.submission.id)).toContain(outcome.submissionId);
    expect(judged[0]?.submission.projectId).toBe(outcome.projectId);
  });

  it("keeps the submission when the progress update is rejected", async () => {
    progress.fail = true;

    const outcome = await createProjectSubmission(guestSubmissionStore(), draft(), {
      fileSubmission: true,
    });

    expect(outcome.submissionId).toBeTruthy();
    const mine = await listCandidateSubmissions(CANDIDATE);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.submission.id).toBe(outcome.submissionId);
    // Rejected bookkeeping is logged, never thrown.
    expect(console.warn).toHaveBeenCalled();
  });

  it("reuses the existing submission when the candidate retries", async () => {
    const first = await createProjectSubmission(guestSubmissionStore(), draft(), {
      fileSubmission: true,
    });

    const retry = await createProjectSubmission(
      guestSubmissionStore(),
      draft({ projectName: "Aurora v2", websiteUrl: "https://v2.aurora.example.com" }),
      { fileSubmission: true },
    );

    // Same rows, one submission: a retry edits the entry, it does not clone it.
    expect(retry.projectId).toBe(first.projectId);
    expect(retry.reportId).toBe(first.reportId);
    expect(retry.submissionId).toBe(first.submissionId);
    expect(listGuestReports()).toHaveLength(1);

    const mine = await listCandidateSubmissions(CANDIDATE);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.submission.teamName).toBe("Team Aurora");
    expect(mine[0]?.submission.websiteUrl).toBe("https://v2.aurora.example.com");
  });
});

describe("submission failures", () => {
  it("removes the project it created when the report cannot be written", async () => {
    const failure = Object.assign(new Error("new row violates row-level security policy"), {
      code: "42501",
    });
    const { store, projects, reports, discarded } = memoryStore({
      async createReport() {
        throw failure;
      },
    });

    await expect(createProjectSubmission(store, draft(), { fileSubmission: true })).rejects.toThrow(
      SubmissionError,
    );

    expect(projects).toHaveLength(1);
    expect(reports).toHaveLength(0);
    expect(discarded).toEqual([{ projectId: "project-1", reportId: null }]);
  });

  it("names the failing step and keeps the original database error", async () => {
    const failure = Object.assign(new Error("new row violates row-level security policy"), {
      code: "42501",
      details: "Row violates the policy projects_insert",
      hint: null,
    });
    const { store } = memoryStore({
      async createReport() {
        throw failure;
      },
    });

    const caught = await createProjectSubmission(store, draft(), {
      fileSubmission: true,
    }).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(SubmissionError);
    const submissionError = caught as SubmissionError;
    expect(submissionError.step).toBe("create-report");
    expect(submissionError.code).toBe("42501");
    expect(submissionError.details).toBe("Row violates the policy projects_insert");
    // The wrapped service error is still reachable — nothing was swallowed.
    expect(String(submissionError.cause)).toContain("row-level security");

    // And the failure was logged with its context, not just "Submission failed".
    expect(errorLog).toHaveBeenCalledWith(
      "[submission] failed",
      expect.objectContaining({ step: "create-report", code: "42501" }),
    );
    expect(describeSubmissionFailure(caught).message).toMatch(/policy/i);
  });

  it("removes the project and report when the submission cannot be filed", async () => {
    const { store, discarded } = memoryStore();

    const caught = await createProjectSubmission(store, draft({ hackathon: phantomHackathon() }), {
      fileSubmission: true,
    }).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(SubmissionError);
    expect((caught as SubmissionError).step).toBe("create-submission");
    expect(discarded).toEqual([{ projectId: "project-1", reportId: "report-2" }]);
    // No half-submission survives: the candidate's history stays empty.
    expect(await listCandidateSubmissions(CANDIDATE)).toHaveLength(0);
  });

  it("explains a missing schema instead of hiding it", () => {
    const failure = new SubmissionError(
      "create-project",
      Object.assign(
        new Error("Could not find the 'source' column of 'projects' in the schema cache"),
        {
          code: "PGRST204",
        },
      ),
    );

    const view = describeSubmissionFailure(failure);
    expect(view.message).toMatch(/migrations/i);
    expect(view.message).not.toMatch(/couldn't create this project review/i);
  });
});
