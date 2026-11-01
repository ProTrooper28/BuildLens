import { beforeEach, describe, expect, it } from "vitest";

import {
  advanceSubmissionStatus,
  createHackathon,
  findHackathonByCode,
  generateJoinCode,
  getSubmissionForCandidate,
  getSubmissionForJudge,
  lifecycleStage,
  listCandidateSubmissions,
  listHackathonJudges,
  listJudgeHackathons,
  listJudgeSubmissions,
  normaliseJoinCode,
  portalStorageNotice,
  resetPortalStorageState,
  setHackathonJudges,
  setPublishedResult,
  submitToHackathon,
  submissionStatusLabel,
  syncSubmissionProgress,
} from "@/services/hackathon.service";
import {
  fetchSubmissionDetail,
  fetchSubmissionSummaries,
} from "@/services/judging/submissions.service";
import { LOCAL_JUDGE_ID } from "@/services/judging/store";

/**
 * The shared hackathon portal, end to end.
 *
 * No Supabase is configured in this environment, so these run on the local
 * journal — the same code path a guest or an un-migrated project uses. Every
 * assertion is about the *contract* the database also enforces (unique
 * (hackathon, candidate), forward-only status, judge-scoped reads), so the remote
 * path is covered by the same expectations.
 */

const ORGANIZER = "judge-a";
const OTHER_ORGANIZER = "judge-b";
const CANDIDATE = "candidate-1";
const OTHER_CANDIDATE = "candidate-2";

async function seedHackathon(name = "Climate Hack", organizer = ORGANIZER) {
  return createHackathon({ id: organizer, name: "Organizer" }, { name });
}

async function seedSubmission(
  hackathonId: string,
  overrides: Partial<Parameters<typeof submitToHackathon>[0]> = {},
) {
  return submitToHackathon({
    hackathonId,
    candidateId: CANDIDATE,
    teamName: "Ledger Lens",
    teamMembers: ["Ada", "Grace"],
    description: "Turns receipts into a ledger.",
    repoUrl: "https://github.com/team/ledger-lens",
    websiteUrl: "https://ledger.example.com",
    deckName: "ledger-lens.pptx",
    projectId: "project-row-1",
    reportId: "report-row-1",
    ...overrides,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  resetPortalStorageState();
});

describe("join codes", () => {
  it("normalises what a candidate types and rejects junk", () => {
    expect(normaliseJoinCode("  hack-01 ")).toBe("HACK-01");
    expect(normaliseJoinCode("climate 2026")).toBe("CLIMATE-2026");
    expect(normaliseJoinCode("!!")).toBe("");
    expect(normaliseJoinCode("ab")).toBe("");
  });

  it("generates a usable code from the name", () => {
    const code = generateJoinCode("Climate Hack 2026");
    expect(code.startsWith("CLIMATE-HACK")).toBe(true);
    expect(normaliseJoinCode(code)).toBe(code);
  });

  it("resolves a code case-insensitively", async () => {
    const hackathon = await seedHackathon();
    const found = await findHackathonByCode(hackathon.code.toLowerCase(), CANDIDATE);
    expect(found?.id).toBe(hackathon.id);
    expect(await findHackathonByCode("NOPE-9999", CANDIDATE)).toBeNull();
  });

  it("refuses a duplicate code", async () => {
    const first = await seedHackathon("First");
    await expect(
      createHackathon({ id: ORGANIZER }, { name: "Second", code: first.code }),
    ).rejects.toThrow(/already in use/i);
  });
});

describe("candidate submission → judge portal", () => {
  it("puts the submitted project in the organizer's submissions", async () => {
    const hackathon = await seedHackathon();
    const submission = await seedSubmission(hackathon.id);

    expect(submission.status).toBe("submitted");
    expect(submission.candidateId).toBe(CANDIDATE);

    const rows = await listJudgeSubmissions(ORGANIZER);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hackathon.id).toBe(hackathon.id);
    expect(rows[0]?.submission.id).toBe(submission.id);
  });

  it("opens the exact same record the candidate sent", async () => {
    const hackathon = await seedHackathon();
    const submission = await seedSubmission(hackathon.id);

    const opened = await getSubmissionForJudge(submission.id, ORGANIZER);
    expect(opened?.submission.id).toBe(submission.id);
    expect(opened?.submission.repoUrl).toBe("https://github.com/team/ledger-lens");
    expect(opened?.submission.websiteUrl).toBe("https://ledger.example.com");
    expect(opened?.submission.deckName).toBe("ledger-lens.pptx");
    expect(opened?.submission.teamMembers).toEqual(["Ada", "Grace"]);
    expect(opened?.hackathon?.code).toBe(hackathon.code);
  });

  it("feeds the judging list and detail with the shared submission", async () => {
    const hackathon = await seedHackathon();
    const submission = await seedSubmission(hackathon.id);

    const summaries = await fetchSubmissionSummaries("project", {
      userId: ORGANIZER,
      isGuest: false,
    });
    const row = summaries.find((entry) => entry.id === `project:${submission.id}`);
    expect(row?.name).toBe("Ledger Lens");
    expect(row?.subtitle).toContain(hackathon.code);

    const detail = await fetchSubmissionDetail(`project:${submission.id}`, {
      userId: ORGANIZER,
      isGuest: false,
    });
    expect(detail?.category).toBe("project");
    if (detail?.category !== "project") throw new Error("expected a project detail");
    expect(detail.sharedSubmission?.hackathonId).toBe(hackathon.id);
    expect(detail.repoUrl).toBe("https://github.com/team/ledger-lens");
    expect(detail.teamMembers).toEqual([
      { name: "Ada", role: null },
      { name: "Grace", role: null },
    ]);
  });

  it("updates one submission when the button is pressed twice", async () => {
    const hackathon = await seedHackathon();
    const first = await seedSubmission(hackathon.id);
    const second = await seedSubmission(hackathon.id, {
      teamName: "Ledger Lens v2",
      websiteUrl: "https://v2.ledger.example.com",
    });

    expect(second.id).toBe(first.id);
    const rows = await listJudgeSubmissions(ORGANIZER, hackathon.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.submission.teamName).toBe("Ledger Lens v2");
    expect(rows[0]?.submission.websiteUrl).toBe("https://v2.ledger.example.com");
    // The original submission time is kept — this is the same entry, edited.
    expect(rows[0]?.submission.submittedAt).toBe(first.submittedAt);
  });
});

describe("submission lifecycle", () => {
  it("moves forward through analysis, review and evaluation", async () => {
    const hackathon = await seedHackathon();
    const submission = await seedSubmission(hackathon.id);

    expect(lifecycleStage(submission.status)).toBe(1);

    await syncSubmissionProgress(submission.id, CANDIDATE, { status: "processing" });
    let current = await getSubmissionForCandidate(submission.id, CANDIDATE);
    expect(current?.submission.status).toBe("processing");

    await syncSubmissionProgress(submission.id, CANDIDATE, { status: "analyzed" });
    current = await getSubmissionForCandidate(submission.id, CANDIDATE);
    expect(current?.submission.status).toBe("analyzed");
    expect(submissionStatusLabel(current!.submission.status)).toBe("Analysis complete");

    await advanceSubmissionStatus(submission.id, ORGANIZER, "under_review");
    await advanceSubmissionStatus(submission.id, ORGANIZER, "evaluated");
    current = await getSubmissionForCandidate(submission.id, CANDIDATE);
    expect(current?.submission.status).toBe("evaluated");

    // Forward-only: a stale tab cannot rewind a reviewed submission.
    await advanceSubmissionStatus(submission.id, ORGANIZER, "processing");
    current = await getSubmissionForCandidate(submission.id, CANDIDATE);
    expect(current?.submission.status).toBe("evaluated");
  });

  it("does not let a candidate score their own submission", async () => {
    const hackathon = await seedHackathon();
    const submission = await seedSubmission(hackathon.id);

    const attempted = await advanceSubmissionStatus(submission.id, CANDIDATE, "evaluated");
    expect(attempted).toBeNull();
    const current = await getSubmissionForCandidate(submission.id, CANDIDATE);
    expect(current?.submission.status).toBe("submitted");
  });

  it("refuses to submit to a closed hackathon", async () => {
    const hackathon = await seedHackathon();
    // Close it the way the organizer would.
    await advanceSubmissionStatus(
      (await seedSubmission(hackathon.id, { candidateId: OTHER_CANDIDATE })).id,
      ORGANIZER,
      "submitted",
    );
    const closed = await createHackathon(
      { id: ORGANIZER },
      { name: "Finished Hack", code: "FINISHED-1", status: "complete" },
    );
    await expect(seedSubmission(closed.id, { candidateId: "candidate-3" })).rejects.toThrow(
      /closed/i,
    );
  });
});

describe("published results", () => {
  it("shows the candidate their result only after it is published", async () => {
    const hackathon = await seedHackathon();
    const submission = await seedSubmission(hackathon.id);

    await advanceSubmissionStatus(submission.id, ORGANIZER, "evaluated");

    let mine = await listCandidateSubmissions(CANDIDATE);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.submission.resultPublished).toBe(false);
    expect(mine[0]?.submission.publishedResult).toBeNull();

    const published = await setPublishedResult(submission.id, ORGANIZER, {
      total: 812,
      maxScore: 1000,
      percent: 81.2,
      rank: 2,
    });
    expect(published?.resultPublished).toBe(true);
    expect(published?.status).toBe("finalized");

    mine = await listCandidateSubmissions(CANDIDATE);
    expect(mine[0]?.submission.publishedResult?.total).toBe(812);
    expect(mine[0]?.submission.publishedResult?.rank).toBe(2);
    expect(mine[0]?.submission.resultPublished).toBe(true);

    // Withdrawing hides it again without touching the stored evaluation.
    await setPublishedResult(submission.id, ORGANIZER, null);
    mine = await listCandidateSubmissions(CANDIDATE);
    expect(mine[0]?.submission.resultPublished).toBe(false);
    expect(mine[0]?.submission.publishedResult).toBeNull();
  });

  it("keeps one candidate's submission invisible to another candidate", async () => {
    const hackathon = await seedHackathon();
    const submission = await seedSubmission(hackathon.id);

    expect(await listCandidateSubmissions(OTHER_CANDIDATE)).toHaveLength(0);
    expect(await getSubmissionForCandidate(submission.id, OTHER_CANDIDATE)).toBeNull();
  });
});

describe("hackathon isolation", () => {
  it("never shows Hackathon A's project to Hackathon B's judge", async () => {
    const a = await seedHackathon("Hackathon A", ORGANIZER);
    const b = await seedHackathon("Hackathon B", OTHER_ORGANIZER);
    const submission = await seedSubmission(a.id);

    const bRows = await listJudgeSubmissions(OTHER_ORGANIZER);
    expect(bRows).toHaveLength(0);

    const bList = await listJudgeSubmissions(OTHER_ORGANIZER, b.id);
    expect(bList).toHaveLength(0);

    expect(await getSubmissionForJudge(submission.id, OTHER_ORGANIZER)).toBeNull();
    expect(await advanceSubmissionStatus(submission.id, OTHER_ORGANIZER, "evaluated")).toBeNull();
    expect(
      await setPublishedResult(submission.id, OTHER_ORGANIZER, {
        total: 1,
        maxScore: 1000,
        percent: 0.1,
        rank: 1,
      }),
    ).toBeNull();

    // Filtering by hackathon id still respects the viewer's access.
    const bJudgeOnA = await listJudgeSubmissions(OTHER_ORGANIZER, a.id);
    expect(bJudgeOnA).toHaveLength(0);
  });

  it("gives an assigned judge access without giving them the organizer list", async () => {
    const a = await seedHackathon("Hackathon A", ORGANIZER);
    const b = await seedHackathon("Hackathon B", ORGANIZER);
    await setHackathonJudges(a.id, ORGANIZER, [OTHER_ORGANIZER]);

    const visible = await listJudgeHackathons(OTHER_ORGANIZER);
    expect(visible.map((entry) => entry.id)).toEqual([a.id]);
    expect(await listHackathonJudges(b.id, OTHER_ORGANIZER)).toEqual([]);

    const submission = await seedSubmission(a.id);
    expect(await getSubmissionForJudge(submission.id, OTHER_ORGANIZER)).not.toBeNull();
  });

  it("only lets the organizer change the judging panel", async () => {
    const hackathon = await seedHackathon();
    await expect(
      setHackathonJudges(hackathon.id, OTHER_ORGANIZER, [OTHER_ORGANIZER]),
    ).rejects.toThrow(/organizer/i);
  });

  it("isolates which submitter a judge may list", async () => {
    const a = await seedHackathon("Hackathon A", ORGANIZER);
    const b = await seedHackathon("Hackathon B", OTHER_ORGANIZER);
    await seedSubmission(a.id, { candidateId: CANDIDATE });
    await seedSubmission(b.id, { candidateId: OTHER_CANDIDATE, teamName: "Other Team" });

    const aRows = await listJudgeSubmissions(ORGANIZER);
    expect(aRows.map((row) => row.submission.candidateId)).toEqual([CANDIDATE]);

    const bRows = await listJudgeSubmissions(OTHER_ORGANIZER);
    expect(bRows.map((row) => row.submission.candidateId)).toEqual([OTHER_CANDIDATE]);
  });
});

describe("storage honesty", () => {
  it("says when the portal is running on the browser journal", async () => {
    expect(portalStorageNotice()).toBeNull();
    await listJudgeHackathons(ORGANIZER);
    expect(portalStorageNotice()?.text).toContain("0007_hackathon_portal.sql");
  });

  it("treats the local judge as the organizer of a local hackathon", async () => {
    const hackathon = await createHackathon({ id: LOCAL_JUDGE_ID }, { name: "Local Hack" });
    const submission = await seedSubmission(hackathon.id);
    const rows = await listJudgeSubmissions(LOCAL_JUDGE_ID);
    expect(rows.map((row) => row.submission.id)).toContain(submission.id);
  });
});
