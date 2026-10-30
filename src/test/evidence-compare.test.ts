/**
 * Claim → evidence comparison.
 *
 * The rule under test is the product rule: unreadable evidence is never a
 * negative finding, and the deck can never verify itself.
 */

import { describe, expect, it } from "vitest";

import {
  buildEvidenceBundle,
  claimsFromSubmission,
  compareClaims,
  type ClaimInput,
} from "@/services/evidence";
import type { IngestionOutcome } from "@/services/ingestion/types";

const repo: IngestionOutcome = {
  kind: "repository",
  status: "ingested",
  detail: "Repository read.",
  url: "https://github.com/acme/app",
  facts: ["Frameworks detected: React.", "Declared dependencies: react, vite, vitest."],
  text: `Repository: acme/app
README (README.md):
# Acme App
The dashboard analyses climate risk for portfolios and ships a Vitest test suite.`,
  segments: [
    { ref: "GitHub: package.json", kind: "config", text: "dependencies: react, vite, vitest" },
    {
      ref: "GitHub: src/dashboard.ts",
      kind: "implementation",
      text: "export function analyseClimateRisk(holdings) { /* analyses climate risk for every portfolio in the dashboard */ }",
    },
    {
      ref: "GitHub: acme/app file list",
      kind: "implementation",
      text: "src/dashboard.ts\nsrc/main.tsx",
    },
    {
      ref: "GitHub: README.md",
      kind: "documentation",
      text: "# Acme App\nThe dashboard analyses climate risk for portfolios and ships a Vitest test suite.\n- We also forecast crop yield with TensorFlow models.",
    },
  ],
};

const site: IngestionOutcome = {
  kind: "website",
  status: "ingested",
  detail: "Site fetched.",
  url: "https://acme.example.com/",
  facts: ["HTTP 200 from acme.example.com."],
  text: `Deployed site: https://acme.example.com/
Visible text:
Acme turns climate risk into portfolio actions. We reduced reporting time by 40% for analysts.`,
  segments: [
    {
      ref: "Deployed page: https://acme.example.com/",
      kind: "runtime",
      text: "Acme turns climate risk into portfolio actions. We reduced reporting time by 40% for analysts.",
    },
  ],
};

const deck: IngestionOutcome = {
  kind: "document",
  status: "ingested",
  detail: "Deck read.",
  text: "Climate risk dashboard. Claims: React, 40% faster reporting.",
  facts: [],
};

function claim(
  id: string,
  text: string,
  category: ClaimInput["category"] = "solution",
): ClaimInput {
  return { id, claim: text, category };
}

describe("compareClaims", () => {
  it("marks a claim supported when readable sources state it", () => {
    const [check] = compareClaims(
      [claim("c1", "The dashboard analyses climate risk for portfolios")],
      [repo],
    );
    expect(check?.status).toBe("supported");
    expect(check?.sources).toContain("repository");
    expect(check?.quotes.join(" ")).toMatch(/climate risk/);
    // The judge can open exactly where it came from.
    expect(check?.evidenceRefs).toContain("GitHub: src/dashboard.ts");
  });

  it("does not let a README verify a claim on its own", () => {
    const [check] = compareClaims(
      [claim("c1", "We also forecast crop yield with TensorFlow models")],
      [repo],
    );
    expect(check?.status).toBe("not_found");
    expect(check?.note).toMatch(/not proof that the claim is false/i);
    // For a missing claim the refs list what was searched.
    expect(check?.evidenceRefs).toContain("GitHub: acme/app");
  });

  it("marks a claim partially supported when only part appears", () => {
    const [check] = compareClaims(
      [claim("c1", "The product uses React and TensorFlow for portfolio forecasting")],
      [repo, site],
    );
    expect(check?.status).toBe("partially_supported");
  });

  it("marks a claim not found only when the sources were actually read", () => {
    const [check] = compareClaims([claim("c1", "It uses TensorFlow for training")], [repo, site]);
    expect(check?.status).toBe("not_found");
    expect(check?.note).toMatch(/not proof that the claim is false/i);
  });

  it("never turns unreadable evidence into a negative finding", () => {
    const [check] = compareClaims(
      [claim("c1", "It uses TensorFlow for training")],
      [
        { kind: "repository", status: "failed", text: null, detail: "Rate limited." },
        { kind: "website", status: "pending", text: null, detail: "No site provided." },
      ],
    );
    expect(check?.status).toBe("could_not_verify");
    expect(check?.note).toMatch(/not contradicted/i);
  });

  it("does not let the submitted deck verify its own claims", () => {
    const [check] = compareClaims([claim("c1", "Built with React and Supabase")], [deck]);
    expect(check?.status).toBe("could_not_verify");
    expect(check?.sources).toEqual([]);
  });

  it("matches numeric claims against the readable evidence", () => {
    const [found, missing] = compareClaims(
      [
        claim("c1", "Reduced reporting time by 40%", "impact"),
        claim("c2", "Reduced reporting time by 90%", "impact"),
      ],
      [site],
    );
    expect(found?.status).toBe("supported");
    expect(missing?.status).toBe("not_found");
  });
});

describe("buildEvidenceBundle", () => {
  const submission = {
    name: "Acme",
    description: "A climate-risk dashboard for portfolios.",
    repoUrl: "https://github.com/acme/app",
    websiteUrl: "https://acme.example.com",
    technologies: ["React"],
    presentation: {
      name: "acme.pptx",
      text: "Acme deck",
      claims: {
        summary: "Acme is a climate-risk dashboard.",
        problem: ["Analysts cannot see portfolio climate exposure"],
        technology: ["React", "TensorFlow"],
        impact: ["40% faster reporting"],
        method: "heuristic" as const,
      },
    },
  };

  it("collects every claim and reports sources, gaps and counts", () => {
    const bundle = buildEvidenceBundle(submission, [repo, site, deck]);

    // Deck claims come first, then the form fields and declared technologies.
    expect(bundle.claims[0]?.id).toBe("deck.problem.0");
    expect(bundle.claims.map((c) => c.category)).toContain("technology");
    expect(bundle.claims.some((c) => c.claim === "React")).toBe(true);

    // The submission form is a source, and it is always readable.
    expect(bundle.sources[0]?.kind).toBe("submission");
    expect(bundle.sources.map((source) => source.kind)).toEqual([
      "submission",
      "repository",
      "website",
      "document",
    ]);
    expect(bundle.sources.find((source) => source.kind === "repository")?.readable).toBe(true);
    expect(bundle.sources.find((source) => source.kind === "document")?.readable).toBe(true);

    const total = Object.values(bundle.counts).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(bundle.claims.length);
    expect(bundle.counts.supported).toBeGreaterThan(0);
    expect(bundle.disclaimer).toMatch(/not a negative finding/i);
  });

  it("cites the deck page a claim was found on", () => {
    const bundle = buildEvidenceBundle(
      {
        ...submission,
        presentation: {
          ...submission.presentation,
          pages: [
            { page: 2, text: "Problem\nAnalysts cannot see portfolio climate exposure in one place" },
            { page: 7, text: "Technology\nBuilt with React and TensorFlow" },
          ],
        },
      },
      [repo, site, deck],
    );

    expect(bundle.claims.find((entry) => entry.id === "deck.problem.0")?.pageRefs).toEqual([2]);
    // No page contains this claim, so no page is guessed.
    expect(bundle.claims.find((entry) => entry.claim === "40% faster reporting")?.pageRefs).toEqual(
      [],
    );
  });

  it("records unreadable sources as gaps without inventing data", () => {
    const bundle = buildEvidenceBundle(submission, [
      { kind: "repository", status: "failed", text: null, detail: "Repository rate limited." },
      { kind: "website", status: "pending", text: null, detail: "No site provided." },
      {
        kind: "document",
        status: "ingested",
        text: submission.presentation.text,
        detail: "Deck read.",
      },
    ]);

    expect(bundle.gaps).toHaveLength(2);
    expect(bundle.gaps.join(" ")).toMatch(/rate limited/);
    expect(bundle.counts.could_not_verify).toBe(bundle.claims.length);
    expect(bundle.counts.not_found).toBe(0);
  });

  it("deduplicates identical claims and caps the list", () => {
    const claims = claimsFromSubmission({
      name: "Dup",
      description: "Same description",
      technologies: ["Same description", "React", "React"],
    });
    expect(claims.filter((entry) => entry.claim === "Same description")).toHaveLength(1);
    expect(claims.filter((entry) => entry.claim === "React")).toHaveLength(1);
    expect(claims.length).toBeLessThanOrEqual(24);
  });
});
