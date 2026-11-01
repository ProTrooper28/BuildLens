/**
 * Candidate claim vs verified fact.
 *
 * The rule under test is the product's central one:
 *
 *   CANDIDATE SAID IT  ≠  BUILDLENS VERIFIED IT
 *
 * A deck's title page, team ID and diagram labels are candidate-provided
 * metadata — they must never be verified, counted as claims, or turned into
 * judge warnings. Only meaningful assertions enter the pipeline, and their
 * verdicts are driven by evidence, not by absence of it.
 */

import { describe, expect, it } from "vitest";

import {
  buildEvidenceBundle,
  claimTypeOf,
  compareClaims,
  isCandidateMetadata,
  type ClaimInput,
  type ClaimCheck,
} from "@/services/evidence";
import { extractDocumentClaims } from "@/services/document";
import type { IngestionOutcome } from "@/services/ingestion/types";
import { buildInspectionReport } from "@/services/inspection";
import type { ProjectDetail } from "@/types/evaluation";

/* --------------------------------------------------------------- fixtures */

const DECK_TEXT = [
  "TITLE PAGE",
  "SMART INDIA HACKATHON 2026",
  "Team ID - 176743",
  "Team Name - CodeXCapsules",
  "Browser Extension",
  "Local CV",
  "GOES TO",
  "SENDS",
  "Automated tasks run every 5 minutes",
].join("\n");

const vueRepository: IngestionOutcome = {
  kind: "repository",
  status: "ingested",
  detail: "Repository inspected.",
  url: "https://github.com/codexcapsules/extension",
  facts: [],
  text: "Repository: codexcapsules/extension",
  observations: [],
  segments: [
    { ref: "GitHub: package.json", kind: "config", text: "dependencies: vue, vite, vitest" },
    {
      ref: "GitHub: src/background.ts",
      kind: "implementation",
      text: "chrome.runtime.onMessage.addListener(handleMessage);",
    },
  ],
};

function claim(id: string, text: string): ClaimInput {
  return { id, claim: text, category: "features" };
}

const project: ProjectDetail = {
  id: "project:1",
  category: "project",
  source: "workspace",
  name: "CodeXCapsules",
  subtitle: null,
  description: "A browser extension that tailors CVs locally.",
  tags: [],
  yearsExperience: null,
  projectCategory: "Submitted",
  createdAt: "2026-02-01T00:00:00.000Z",
  team: null,
  problemStatement: null,
  solution: null,
  technologies: [],
  repoUrl: "https://github.com/codexcapsules/extension",
  demoUrl: null,
  media: [],
  teamMembers: [],
  submitted: [],
  presentationClaims: null,
};

/* ------------------------------------------------------- metadata vs claims */

describe("candidate metadata is not a claim", () => {
  it("recognises team details, event banners and diagram labels", () => {
    expect(isCandidateMetadata("Team ID - 176743")).toBe(true);
    expect(isCandidateMetadata("Team Name - CodeXCapsules")).toBe(true);
    expect(isCandidateMetadata("SMART INDIA HACKATHON 2026")).toBe(true);
    expect(isCandidateMetadata("Title page")).toBe(true);
    expect(isCandidateMetadata("GOES TO")).toBe(true);
    expect(isCandidateMetadata("SENDS")).toBe(true);
    expect(isCandidateMetadata("176743")).toBe(true);
  });

  it("keeps short feature statements as claims", () => {
    expect(isCandidateMetadata("Browser Extension")).toBe(false);
    expect(isCandidateMetadata("Local CV")).toBe(false);
    expect(isCandidateMetadata("Automated tasks")).toBe(false);
  });

  it("classifies what each claim is about", () => {
    expect(claimTypeOf("Team ID - 176743")).toBe("metadata");
    expect(claimTypeOf("Browser Extension")).toBe("feature");
    expect(claimTypeOf("90% faster processing", "impact")).toBe("security_performance");
    expect(claimTypeOf("Built with React", "technology")).toBe("technology");
  });

  it("drops metadata, banners and flow labels during extraction", () => {
    const claims = extractDocumentClaims(DECK_TEXT);
    const all = [
      ...claims.problem,
      ...claims.solution,
      ...claims.features,
      ...claims.technology,
      ...claims.impact,
    ].join(" | ");
    expect(all).not.toMatch(/176743|CodeXCapsules|HACKATHON|GOES TO|SENDS/);
    expect(all).toMatch(/Browser Extension/);
  });

  it("reports candidate-provided facts separately and keeps junk out of the claims", () => {
    const bundle = buildEvidenceBundle(
      {
        name: "CodeXCapsules",
        presentation: {
          name: "deck.pptx",
          text: DECK_TEXT,
          claims: {
            features: ["Browser Extension", "Local CV", "GOES TO", "Team ID - 176743"],
            impact: ["90% faster processing"],
            method: "heuristic",
          },
          pages: [{ page: 1, text: DECK_TEXT }],
        },
      },
      [vueRepository],
    );

    const claimText = bundle.claims.map((entry) => entry.claim);
    expect(claimText).toContain("Browser Extension");
    expect(claimText).toContain("Local CV");
    expect(claimText.some((text) => /176743|GOES TO|Team Name/.test(text))).toBe(false);

    const facts = bundle.candidateProvided ?? [];
    expect(facts.some((fact) => fact.label === "Team ID" && fact.value === "176743")).toBe(true);
    expect(facts.some((fact) => fact.label === "Team name" && fact.value === "CodeXCapsules")).toBe(
      true,
    );
    // Every fact keeps the place it came from.
    expect(facts.every((fact) => fact.source.includes("slide 1"))).toBe(true);
  });
});

/* ---------------------------------------------------------- claim verdicts */

describe("claim verdicts are evidence-based", () => {
  it("marks a stack claim contradicted when the repository declares a different stack", () => {
    const [check] = compareClaims([claim("c1", "Built with React")], [vueRepository]);
    expect(check?.verdict).toBe("contradicted");
    expect(check?.contradiction).toMatch(/vue/i);
  });

  it("does not call an absent claim contradicted — only unverified", () => {
    const [check] = compareClaims([claim("c1", "Supports offline sync")], [vueRepository]);
    expect(check?.verdict).toBe("unverified");
    expect(check?.contradiction).toBeNull();
    expect(check?.note).toMatch(/not proof that the claim is false/i);
  });

  it("marks a quantified claim with no supporting figure as unsupported", () => {
    const [check] = compareClaims([claim("c1", "90% faster processing")], [vueRepository]);
    expect(check?.verdict).toBe("unsupported");
  });

  it("records what each independent source showed", () => {
    const [check] = compareClaims([claim("c1", "Message handling")], [vueRepository]);
    expect(check?.bySource?.repository).toBeDefined();
    // No deployed URL was read, so the live column is honestly not checked.
    expect(check?.bySource?.website).toBe("not_checked");
  });
});

/* -------------------------------------------------------------- attention */

describe("judge attention is grouped and risk-based", () => {
  const bundle = buildEvidenceBundle(
    {
      name: "CodeXCapsules",
      presentation: {
        name: "deck.pptx",
        text: DECK_TEXT,
        claims: {
          features: ["Offline sync", "Local CV", "Batch export", "Team dashboard"],
          impact: ["90% faster processing"],
          method: "heuristic",
        },
        pages: [{ page: 1, text: DECK_TEXT }],
      },
    },
    [vueRepository],
  );

  const report = buildInspectionReport({ detail: project, bundle, evaluation: null });

  it("collapses many missing claims into one concern", () => {
    const claimConcerns = report.verdict.keyConcerns.filter(
      (concern) =>
        /could not be verified|could not be found|without a supporting figure/i.test(concern.text),
    );
    expect(claimConcerns.length).toBeLessThanOrEqual(3);
    // Grouped, with a count — not one concern per claim.
    expect(claimConcerns.some((concern) => /\d+ (claimed feature|claim)/i.test(concern.text))).toBe(
      true,
    );
  });

  it("never turns metadata into a concern", () => {
    const text = report.verdict.keyConcerns.map((concern) => concern.text).join(" | ");
    expect(text).not.toMatch(/176743|CodeXCapsules|GOES TO|HACKATHON/);
    expect(report.verdict.claimed.join(" | ")).not.toMatch(/176743|GOES TO/);
  });

  it("surfaces candidate-provided facts on the verdict, unverified", () => {
    expect(report.verdict.candidateProvided.some((fact) => fact.label === "Team ID")).toBe(true);
  });
});

/* ------------------------------------------------------------ claim shape */

describe("claims carry their source and per-source evidence", () => {
  it("keeps the slide a claim was found on", () => {
    const bundle = buildEvidenceBundle(
      {
        name: "CodeXCapsules",
        presentation: {
          name: "deck.pptx",
          text: DECK_TEXT,
          claims: { features: ["Browser Extension"], method: "heuristic" },
          pages: [
            { page: 1, text: "Team ID - 176743" },
            { page: 4, text: "Features\nBrowser Extension" },
          ],
        },
      },
      [vueRepository],
    );

    const claimEntry = bundle.claims.find(
      (entry: ClaimCheck) => entry.claim === "Browser Extension",
    );
    expect(claimEntry?.pageRefs).toContain(4);
    expect(claimEntry?.sourceRef).toContain("Candidate deck");
  });
});
