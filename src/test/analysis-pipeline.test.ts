import { describe, expect, it, vi } from "vitest";

import { runProjectAnalysis, type AnalysisPersistence } from "@/analysis/analysis.service";
import { ANALYSIS_STAGES, type AnalysisInput } from "@/analysis/types";
import { computeScoreboard } from "@/analysis/score";
import {
  createFetchMock,
  githubRepositoryRoutes,
  GITHUB_REPO_URL,
} from "@/test/fixtures/repository";
import type { Json, ReportStatus } from "@/types/database";

// The pipeline itself must never reach Supabase: persistence is injected, and the
// adapters live outside this module.
vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: false,
  getSupabase: () => {
    throw new Error("The analysis pipeline must not call Supabase directly.");
  },
}));

const input: AnalysisInput = {
  projectId: null,
  reportId: "11111111-1111-4111-8111-111111111111",
  name: "Acme App",
  repoUrl: GITHUB_REPO_URL,
  websiteUrl: "https://acme.example.com",
  notes: "Built for a weekend hackathon.",
  attachments: [{ name: "deck.pdf", size: 2048, type: "application/pdf" }],
  createdAt: "2026-01-01T00:00:00.000Z",
};

interface CapturedUpdate {
  status: ReportStatus;
  score: number | null;
  report_data: Json;
}

function recordingPersistence() {
  const updates: CapturedUpdate[] = [];
  const persistence: AnalysisPersistence = {
    async update(patch) {
      updates.push(patch);
    },
  };
  return { persistence, updates };
}

function record(value: unknown, key?: string): Record<string, unknown> {
  const target =
    key === undefined
      ? value
      : value && typeof value === "object"
        ? (value as Record<string, unknown>)[key]
        : undefined;
  return target && typeof target === "object" && !Array.isArray(target)
    ? (target as Record<string, unknown>)
    : {};
}

describe("computeScoreboard", () => {
  it("scores the six categories and skips unmeasured ones", () => {
    const board = computeScoreboard({
      featureClaims: { supported: 3, partial: 1, total: 5 },
      claimEvidenceScore: 60,
      codeQuality: 80,
      maintainability: 70,
      testing: 50,
      security: 60,
      performance: null,
      documentation: 40,
    });

    const points = (key: string) => board.categories.find((entry) => entry.key === key)?.points;
    expect(board.categories).toHaveLength(6);
    // (3 + 0.5·1) / 5 = 70% of the 25 functionality points → 17.5 → 18
    expect(points("functionality")).toBe(18);
    expect(points("claimAccuracy")).toBe(12);
    // (80·.6 + 70·.2 + 50·.2) = 72 of the 15 code-quality points → 10.8 → 11
    expect(points("codeQuality")).toBe(11);
    expect(points("security")).toBe(9);
    expect(points("documentation")).toBe(4);

    // Runtime performance was never measured: no number, and no points counted.
    const performance = board.categories.find((entry) => entry.key === "performance");
    expect(performance?.points).toBeNull();
    expect(performance?.measured).toBe(false);
    expect(performance?.rationale).toContain("Not measured");

    // 54 of 85 measurable points → 64/100
    expect(board.points).toBe(54);
    expect(board.measuredMax).toBe(85);
    expect(board.overall).toBe(64);
  });

  it("is deterministic and clamps out-of-range inputs", () => {
    const input = {
      featureClaims: { supported: 1, partial: 0, total: 2 },
      claimEvidenceScore: 140,
      codeQuality: 140,
      maintainability: -20,
      testing: 0,
      security: -20,
      performance: 90,
      documentation: 55,
    };
    const first = computeScoreboard(input);
    const second = computeScoreboard(input);
    expect(first).toEqual(second);
    const points = (key: string) => first.categories.find((entry) => entry.key === key)?.points;
    expect(points("claimAccuracy")).toBe(20);
    expect(points("security")).toBe(0);
    expect(first.overall).not.toBeNull();
  });

  it("returns no overall score when nothing was measured", () => {
    const board = computeScoreboard({
      featureClaims: null,
      claimEvidenceScore: null,
      codeQuality: null,
      maintainability: null,
      testing: null,
      security: null,
      performance: null,
      documentation: null,
    });
    expect(board.overall).toBeNull();
    expect(board.categories).toHaveLength(6);
    expect(board.measuredMax).toBe(0);
  });
});

describe("runProjectAnalysis", () => {
  it("produces the full report structure from real repository evidence", async () => {
    const { fetchImpl } = createFetchMock(githubRepositoryRoutes());
    const { persistence, updates } = recordingPersistence();

    const result = await runProjectAnalysis({ input, persistence, fetchImpl });

    expect(result.status).toBe("Completed");
    expect(result.error).toBeNull();
    expect(result.score).not.toBeNull();

    const data = record(result.reportData);

    // Executive summary and evidence quote the inspected repository.
    expect(typeof data["executive_summary"]).toBe("string");
    expect(String(data["executive_summary"])).toContain("acme/app");
    expect(data["executive_summary"]).toContain(String(result.score));

    const overview = record(data["overview"]);
    expect(overview["repoUrl"]).toBe(GITHUB_REPO_URL);
    const techStack = overview["techStack"];
    expect(Array.isArray(techStack)).toBe(true);
    expect(techStack).toContain("TypeScript");
    expect(record(data["evidence"])["files_listed"]).toBe(9);

    const architecture = record(data["architecture"]);
    expect(String(architecture["summary"] ?? "")).not.toBe("");
    expect(Array.isArray(architecture["stack"])).toBe(true);
    expect(JSON.stringify(architecture["layers"])).toContain("src");

    expect(String(record(data["code_quality"])["summary"] ?? "")).not.toBe("");
    expect(Array.isArray(record(data["code_quality"])["findings"])).toBe(true);
    expect(Array.isArray(record(data["security"])["findings"])).toBe(true);
    expect(String(record(data["maintainability"])["summary"] ?? "")).not.toBe("");
    expect(String(record(data["documentation"])["summary"] ?? "")).not.toBe("");
    expect(String(record(data["testing"])["summary"] ?? "")).not.toBe("");

    // Performance was not measured, so it is explicitly marked rather than invented.
    expect(JSON.stringify(data["performance"])).toContain("Not enough evidence");

    expect(Array.isArray(data["risks"])).toBe(true);
    const recommendations = data["recommendations"];
    expect(Array.isArray(recommendations)).toBe(true);
    expect((recommendations as unknown[]).length).toBeGreaterThan(0);

    const scores = record(data["scores"]);
    expect(scores["overall"]).toBe(result.score);
    expect(scores["performance"]).toBeNull();
    expect(typeof scores["codeQuality"]).toBe("number");

    // The report's six-category breakdown explains that score.
    const scoreboard = record(data["scoreboard"]);
    expect(scoreboard["overall"]).toBe(result.score);
    const categories = scoreboard["categories"] as { key: string; points: number | null }[];
    expect(categories.map((entry) => entry.key)).toEqual([
      "functionality",
      "claimAccuracy",
      "codeQuality",
      "security",
      "performance",
      "documentation",
    ]);
    expect(categories.find((entry) => entry.key === "performance")?.points).toBeNull();
    expect(typeof categories.find((entry) => entry.key === "codeQuality")?.points).toBe("number");

    const analysis = record(data["analysis"]);
    expect(analysis["state"]).toBe("completed");
    const stages = analysis["stages"] as { key: string; state: string }[];
    expect(stages.map((stage) => stage.key)).toEqual(ANALYSIS_STAGES.map((stage) => stage.key));
    expect(stages.every((stage) => stage.state === "done")).toBe(true);

    // Lifecycle persisted: in progress while working, completed with the score.
    expect(updates.length).toBeGreaterThan(2);
    expect(updates[0]?.status).toBe("In Progress");
    const last = updates.at(-1);
    expect(last?.status).toBe("Completed");
    expect(last?.score).toBe(result.score);
    expect(last?.report_data).toEqual(result.reportData);
  });

  it("preserves the report and marks it failed when the repository is missing", async () => {
    const { fetchImpl } = createFetchMock(() => undefined);
    const { persistence, updates } = recordingPersistence();

    const result = await runProjectAnalysis({ input, persistence, fetchImpl });

    expect(result.status).toBe("Failed");
    expect(result.score).toBeNull();
    expect(result.error?.code).toBe("not-found");

    const data = record(result.reportData);
    const analysis = record(data["analysis"]);
    expect(analysis["state"]).toBe("failed");
    expect(record(analysis["error"])["code"]).toBe("not-found");
    // Nothing was fabricated: unanalyzed sections stay empty.
    expect(data["executive_summary"]).toBeNull();
    expect(record(data["scores"])["overall"]).toBeNull();
    const stages = analysis["stages"] as { key: string; state: string }[];
    expect(stages.some((stage) => stage.state === "failed")).toBe(true);

    // The record is still written so the user keeps the project and sees why.
    const last = updates.at(-1);
    expect(last?.status).toBe("Failed");
    expect(last?.report_data).toBeTruthy();
  });

  it("fails without any network call when no repository URL was submitted", async () => {
    const { fetchImpl, calls } = createFetchMock(githubRepositoryRoutes());
    const { persistence, updates } = recordingPersistence();

    const result = await runProjectAnalysis({
      input: { ...input, repoUrl: null },
      persistence,
      fetchImpl,
    });

    expect(calls).toEqual([]);
    expect(result.status).toBe("Failed");
    expect(result.error?.code).toBe("invalid-url");
    expect(updates.at(-1)?.status).toBe("Failed");
  });

  it("reports an empty repository as malformed instead of scoring it", async () => {
    const { fetchImpl } = createFetchMock(githubRepositoryRoutes({ emptyTree: true }));
    const { persistence } = recordingPersistence();

    const result = await runProjectAnalysis({ input, persistence, fetchImpl });

    expect(result.status).toBe("Failed");
    expect(result.error?.code).toBe("malformed-repository");
    expect(result.score).toBeNull();
  });

  it("propagates a failure to persist the final result instead of claiming success", async () => {
    const { fetchImpl } = createFetchMock(githubRepositoryRoutes());
    const failing: AnalysisPersistence = {
      async update() {
        throw new Error("write failed");
      },
    };

    await expect(runProjectAnalysis({ input, persistence: failing, fetchImpl })).rejects.toThrow(
      "write failed",
    );
  });
});
