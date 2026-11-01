/**
 * Candidate portal → judge portal, end to end.
 *
 * One hackathon code, one submission row, one report: the judge's workspace and
 * project page must read exactly what the candidate wrote — and the candidate must
 * never see a judge score, a note or an unpublished result.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { createGuestReport } from "@/services/guest.service";
import {
  assignSubmissionHackathon,
  createHackathon,
  findHackathonByCode,
  getSubmissionForCandidate,
  listUnassignedSubmissions,
  resetPortalStorageState,
  setPublishedResult,
  submitToHackathon,
} from "@/services/hackathon.service";
import { deleteEvaluation, saveEvaluation } from "@/services/judging/evaluations.service";
import {
  fetchCandidateStatus,
  fetchHackathonWorkspace,
  fetchJudgeProject,
} from "@/services/portal.service";

const JUDGE = "judge-a";
const CANDIDATE = "candidate-1";
const OTHER_CANDIDATE = "candidate-2";
const VIEWER = { userId: JUDGE, isGuest: false };
const CANDIDATE_VIEWER = { userId: CANDIDATE, isGuest: false };

async function seedHackathon() {
  return createHackathon(
    { id: JUDGE, name: "Organizer" },
    { name: "Demo Hackathon 2026", code: "DEMO26" },
  );
}

function seedReport() {
  return createGuestReport({
    type: "Project",
    name: "Ledger Lens",
    status: "Completed",
    report_data: {
      executive_summary: "Turns receipts into a ledger.",
      scores: { overall: 82, codeQuality: 74, security: 60, documentation: 70 },
      claims: [
        {
          claim: "Receipt OCR pipeline",
          status: "supported",
          category: "feature",
          source: "PPT",
          source_location: "Slide 3",
          evidence: "Found src/ocr/pipeline.ts",
          reason: "A matching implementation file was found.",
        },
      ],
      claim_counts: {
        total: 1,
        supported: 1,
        partial: 0,
        unsupported: 0,
        could_not_verify: 0,
        unverified: 0,
      },
      evidence: { repository: "team/ledger-lens", files_listed: 42, readme: "README.md" },
      submission: { document_analysis: { status: "success", file_name: "ledger-lens.pptx" } },
    },
  });
}

async function seedSubmission() {
  const hackathon = await seedHackathon();
  const report = seedReport();
  const submission = await submitToHackathon({
    hackathonId: hackathon.id,
    candidateId: CANDIDATE,
    teamName: "Team Alpha",
    teamMembers: ["Ada", "Grace"],
    description: "Receipts in, ledger out.",
    repoUrl: "https://github.com/team/ledger-lens",
    websiteUrl: "https://ledger.example.com",
    deckName: "ledger-lens.pptx",
    projectId: "project-row-1",
    reportId: report.id,
  });
  return { hackathon, submission, report };
}

beforeEach(() => {
  window.localStorage.clear();
  resetPortalStorageState();
});

describe("hackathon → submission", () => {
  it("resolves the join code case-insensitively and files one submission row", async () => {
    const { submission, hackathon } = await seedSubmission();

    expect(submission.hackathonId).toBe(hackathon.id);
    expect(submission.teamName).toBe("Team Alpha");
    expect(submission.deckName).toBe("ledger-lens.pptx");
    // The candidate's own read is scoped to their id.
    expect(await getSubmissionForCandidate(submission.id, OTHER_CANDIDATE)).toBeNull();
    expect(await getSubmissionForCandidate(submission.id, CANDIDATE)).not.toBeNull();
    expect((await findHackathonByCode("demo26", CANDIDATE))?.id).toBe(hackathon.id);
  });
});

describe("judge workspace", () => {
  it("shows the candidate's submission automatically, with its analysis score", async () => {
    await seedSubmission();

    const workspace = await fetchHackathonWorkspace("DEMO26", VIEWER);
    expect(workspace).not.toBeNull();
    expect(workspace?.hackathon.code).toBe("DEMO26");
    expect(workspace?.rows).toHaveLength(1);

    const row = workspace?.rows[0];
    expect(row?.submission.teamName).toBe("Team Alpha");
    expect(row?.projectName).toBe("Ledger Lens");
    expect(row?.analysis).toBe("ready");
    expect(row?.aiScore).toBe(82);
    expect(row?.judgeScore).toBeNull();
    expect(workspace?.counts).toEqual({
      submissions: 1,
      evaluated: 0,
      pending: 0,
      needsReview: 1,
    });
  });

  it("is empty (not demo data) for a hackathon with no submissions", async () => {
    await seedHackathon();
    const workspace = await fetchHackathonWorkspace("DEMO26", VIEWER);
    expect(workspace?.rows).toEqual([]);
    expect(workspace?.counts.submissions).toBe(0);
  });

  it("returns nothing for a code that does not exist", async () => {
    expect(await fetchHackathonWorkspace("NOPE-1", VIEWER)).toBeNull();
  });

  it("rejects a judge who does not own the hackathon", async () => {
    await seedSubmission();
    expect(
      await fetchHackathonWorkspace("DEMO26", { userId: "judge-b", isGuest: false }),
    ).toBeNull();
  });
});

describe("manual evaluation next to the AI evaluation", () => {
  it("stores the judge score separately and surfaces it in the workspace", async () => {
    const { submission, hackathon } = await seedSubmission();
    const project = await fetchJudgeProject("DEMO26", submission.id, VIEWER);
    expect(project?.analysis.score).toBe(82);
    expect(project?.analysis.view?.claimCounts.total).toBe(1);

    const criteria = {
      category: "project" as const,
      maxScore: hackathon.maxScore,
      criteria: hackathon.criteria,
      updatedAt: hackathon.updatedAt,
    };
    const first = project?.criteria.criteria[0];
    expect(first).toBeDefined();

    await saveEvaluation({
      submissionId: `project:${submission.id}`,
      category: "project",
      judgeId: JUDGE,
      judgeName: "Judge A",
      scores: (project?.criteria.criteria ?? []).map((criterion, index) => ({
        criterionId: criterion.id,
        awarded: index === 0 ? 10 : null,
        note: null,
      })),
      recommendation: "yes",
      note: { body: "Solid pipeline; weak docs.", visibility: "private" },
      criteria,
      status: "evaluated",
    });

    const workspace = await fetchHackathonWorkspace("DEMO26", VIEWER);
    const row = workspace?.rows[0];
    expect(row?.aiScore).toBe(82);
    expect(row?.judgeScore).toBe(10);
    expect(row?.judgeMax).toBe(hackathon.maxScore);
    expect(workspace?.counts.evaluated).toBe(1);
    expect(workspace?.counts.needsReview).toBe(0);

    const refreshed = await fetchJudgeProject("DEMO26", submission.id, VIEWER);
    expect(refreshed?.myEvaluation?.status).toBe("evaluated");
    expect(refreshed?.myEvaluation?.notes?.body).toContain("weak docs");
    // The AI score is untouched by the judge's score.
    expect(refreshed?.analysis.score).toBe(82);

    await deleteEvaluation(`project:${submission.id}`, "project", JUDGE);
    const cleared = await fetchJudgeProject("DEMO26", submission.id, VIEWER);
    expect(cleared?.myEvaluation).toBeNull();
  });
});

describe("candidate status", () => {
  it("reports the submission checks and lifecycle without judge data", async () => {
    const { submission } = await seedSubmission();

    const status = await fetchCandidateStatus(submission.id, CANDIDATE, CANDIDATE_VIEWER);
    expect(status).not.toBeNull();
    expect(status?.projectName).toBe("Ledger Lens");
    // Submitted with a code, so the status page names that event.
    expect(status?.hackathon?.code).toBe("DEMO26");

    const checks = new Map(status?.checks.map((check) => [check.key, check.state]));
    expect(checks.get("deck")).toBe("ok");
    expect(checks.get("repo")).toBe("ok");
    expect(checks.get("deployment")).toBe("ok");
    expect(checks.get("readme")).toBe("ok");

    const steps = status?.steps.map((step) => step.key);
    expect(steps).toEqual([
      "received",
      "documents",
      "repository",
      "deployment",
      "claims",
      "evaluation",
    ]);
    expect(status?.steps[0]?.state).toBe("done");

    // No score, no rank, no judge notes — nothing is published yet.
    expect(status?.result).toBeNull();
    expect(JSON.stringify(status)).not.toContain("weak docs");
  });

  it("shows only the published total, never the notes", async () => {
    const { submission } = await seedSubmission();
    await setPublishedResult(submission.id, JUDGE, {
      total: 76,
      maxScore: 100,
      percent: 76,
      rank: null,
    });

    const status = await fetchCandidateStatus(submission.id, CANDIDATE, CANDIDATE_VIEWER);
    expect(status?.result?.total).toBe(76);
    expect(JSON.stringify(status)).not.toContain("private");
  });

  it("never exposes another candidate's submission", async () => {
    const { submission } = await seedSubmission();
    expect(
      await fetchCandidateStatus(submission.id, OTHER_CANDIDATE, {
        userId: OTHER_CANDIDATE,
        isGuest: false,
      }),
    ).toBeNull();
  });
});

describe("unassigned submissions", () => {
  async function seedUnassigned(teamName = "Team Solo") {
    const report = seedReport();
    return submitToHackathon({
      hackathonId: null,
      candidateId: CANDIDATE,
      teamName,
      teamMembers: ["Linus"],
      description: "Finished project, no code typed.",
      repoUrl: "https://github.com/team/solo",
      websiteUrl: "https://solo.example.com",
      deckName: "solo.pptx",
      projectId: "project-row-solo",
      reportId: report.id,
    });
  }

  it("files a submission without a code and never puts it in a hackathon queue", async () => {
    const submission = await seedUnassigned();
    expect(submission.hackathonId).toBeNull();

    // The candidate's own status page reads it, naming no event.
    const status = await fetchCandidateStatus(submission.id, CANDIDATE, CANDIDATE_VIEWER);
    expect(status?.hackathon).toBeNull();

    // The judge sees it in the intake pool …
    const pool = await listUnassignedSubmissions(JUDGE);
    expect(pool.map((entry) => entry.submission.id)).toContain(submission.id);

    // … and no hackathon's queue contains it, whatever code is opened.
    const demo = await seedHackathon();
    const rows = await fetchHackathonWorkspace(demo.code, VIEWER);
    expect(rows?.rows.map((row) => row.submission.id)).not.toContain(submission.id);
  });

  it("moves the same record into a hackathon when a judge assigns it", async () => {
    const submission = await seedUnassigned();
    const demo = await seedHackathon();

    const assigned = await assignSubmissionHackathon(submission.id, JUDGE, demo.id);
    expect(assigned?.hackathon?.code).toBe("DEMO26");
    expect(assigned?.submission.id).toBe(submission.id);

    // Out of the pool, into that event's judging queue — and onto the
    // candidate's status page, without resubmitting anything.
    expect(
      (await listUnassignedSubmissions(JUDGE)).map((entry) => entry.submission.id),
    ).not.toContain(submission.id);
    const rows = await fetchHackathonWorkspace("DEMO26", VIEWER);
    expect(rows?.rows.map((row) => row.submission.id)).toContain(submission.id);
    const status = await fetchCandidateStatus(submission.id, CANDIDATE, CANDIDATE_VIEWER);
    expect(status?.hackathon?.code).toBe("DEMO26");
  });

  it("refuses a judge who does not organize the target event", async () => {
    const submission = await seedUnassigned();
    const demo = await seedHackathon();

    await expect(assignSubmissionHackathon(submission.id, "judge-b", demo.id)).rejects.toThrow(
      /do not judge/i,
    );
    expect((await listUnassignedSubmissions(JUDGE)).map((entry) => entry.submission.id)).toContain(
      submission.id,
    );
  });

  it("refuses a second submission for a team already in that hackathon", async () => {
    const { hackathon } = await seedSubmission();
    const second = await seedUnassigned();

    await expect(assignSubmissionHackathon(second.id, JUDGE, hackathon.id)).rejects.toThrow(
      /already has a submission/i,
    );
  });

  it("can move an assigned submission back into the pool", async () => {
    const { submission } = await seedSubmission();

    const moved = await assignSubmissionHackathon(submission.id, JUDGE, null);
    expect(moved?.submission.hackathonId).toBeNull();
    expect((await listUnassignedSubmissions(JUDGE)).map((entry) => entry.submission.id)).toContain(
      submission.id,
    );
    const rows = await fetchHackathonWorkspace("DEMO26", VIEWER);
    expect(rows?.rows).toEqual([]);
  });

  it("keeps two hackathons' projects completely separate", async () => {
    // seedSubmission creates DEMO26 with Team Alpha's project …
    const inDemo = await seedSubmission();
    const sih = await createHackathon(
      { id: JUDGE, name: "Organizer" },
      { name: "SIH 2026", code: "SIH26" },
    );
    const report = seedReport();
    const inSih = await submitToHackathon({
      hackathonId: sih.id,
      candidateId: OTHER_CANDIDATE,
      teamName: "Team Beta",
      teamMembers: ["Radia"],
      description: "Second event, second team.",
      repoUrl: "https://github.com/team/beta",
      websiteUrl: "https://beta.example.com",
      deckName: "beta.pptx",
      projectId: "project-row-beta",
      reportId: report.id,
    });

    // …and each event's queue holds exactly its own project.
    expect(inDemo.hackathon.code).toBe("DEMO26");
    const demoRows = await fetchHackathonWorkspace("DEMO26", VIEWER);
    expect(demoRows?.rows.map((row) => row.submission.id)).toEqual([inDemo.submission.id]);
    const sihRows = await fetchHackathonWorkspace("SIH26", VIEWER);
    expect(sihRows?.rows.map((row) => row.submission.id)).toEqual([inSih.id]);
  });
});
