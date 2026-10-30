/**
 * Claim → evidence engine (the judge's claim verdicts).
 *
 * The rules under test are the product rules:
 *
 *   - a claim is supported by implementation/config/runtime evidence, never by
 *     the README that mentions it
 *   - every verdict carries an evidence location a judge can open
 *   - marketing statements and impact claims are JUDGEMENT calls, not misses
 *   - unreadable sources are never turned into a negative finding
 *   - duplicate claims are collapsed instead of counted twice
 */

import { describe, expect, it } from "vitest";

import {
  buildEvidenceBundle,
  claimNatureOf,
  claimsFromDocumentation,
  claimsFromSubmission,
  compareClaims,
  isNearDuplicateClaim,
  type ClaimInput,
} from "@/services/evidence";
import type { IngestionOutcome } from "@/services/ingestion/types";

/* ------------------------------------------------------------------ fixtures */

const repository: IngestionOutcome = {
  kind: "repository",
  status: "ingested",
  detail: "Repository inspected.",
  url: "https://github.com/farmlens/web",
  facts: ["Declared dependencies: react, vite, vitest, next-auth."],
  text: "Repository: farmlens/web\nREADME (README.md):\n# FarmLens",
  observations: [
    {
      id: "repo.code.auth",
      area: "repository",
      label: "Authentication implementation",
      status: "good",
      result: "Authentication wiring was found in the repository.",
      evidence: ["src/auth/login.ts"],
      confidence: "medium",
    },
    {
      id: "repo.code.tests",
      area: "repository",
      label: "Automated tests",
      status: "good",
      result: "1 test file was found in the repository.",
      evidence: ["src/app.test.ts"],
      confidence: "high",
    },
    {
      id: "repo.readme.claims",
      area: "repository",
      label: "README as evidence",
      status: "info",
      result:
        "The README was read as the team's claims. README statements alone were not treated as proof that a feature exists.",
      evidence: ["README.md"],
      confidence: "high",
    },
  ],
  segments: [
    {
      ref: "GitHub: package.json",
      kind: "config",
      text: "dependencies: react, vite, vitest, next-auth",
    },
    {
      ref: "GitHub: src/auth/login.ts",
      kind: "implementation",
      text: 'export async function signInWithGoogle() {\n  return await signInWithOAuth({ provider: "google" });\n}',
    },
    {
      ref: "GitHub: src/lib/recommendations.ts",
      kind: "implementation",
      text: "export function getRecommendations() {\n  // TODO: AI-powered recommendations are not implemented yet\n  return [];\n}",
    },
    {
      ref: "GitHub: farmlens/web file list",
      kind: "implementation",
      text: "package.json\nsrc/auth/login.ts\nsrc/lib/recommendations.ts\nsrc/app.test.ts",
    },
    {
      ref: "GitHub: README.md",
      kind: "documentation",      text: "# FarmLens\n- Supports Google authentication.\n- AI-powered recommendations for every farm.",
    },
  ],
};

const website: IngestionOutcome = {
  kind: "website",
  status: "ingested",
  detail: "Site fetched.",
  url: "https://farmlens.example.com/",
  facts: ["HTTP 200 from farmlens.example.com."],
  text: "Deployed site: https://farmlens.example.com/\nVisible text: FarmLens — climate risk for farms.",
  observations: [
    {
      id: "site.functionality.auth",
      area: "functionality",
      label: "Login / sign-up entry point",
      status: "good",
      result: "The landing page exposes a login entry point (“sign in with google”).",
      evidence: ["sign in with google", "Final URL: https://farmlens.example.com/"],
      confidence: "high",
    },
  ],
  segments: [
    {
      ref: "Deployed page: https://farmlens.example.com/",
      kind: "runtime",
      text: "FarmLens — climate risk for farms. Sign in with Google to see your fields.",
    },
  ],
};

const deck: IngestionOutcome = {
  kind: "document",
  status: "ingested",
  detail: "Deck read.",
  text: "Claims: Google authentication, AI-powered recommendations.",
  facts: [],
};

const unreadable: IngestionOutcome[] = [
  { kind: "repository", status: "failed", text: null, detail: "Repository rate limited." },
  { kind: "website", status: "pending", text: null, detail: "No site provided." },
];

function claim(id: string, text: string): ClaimInput {
  return { id, claim: text, category: "features" };
}

function checkOf(claims: ClaimInput[], outcomes: IngestionOutcome[], id: string) {
  return compareClaims(claims, outcomes).find((entry) => entry.id === id);
}

/* -------------------------------------------------------------------- tests */

describe("claim verdicts", () => {
  it("supports an implementation claim and cites the file and the page", () => {
    const check = checkOf([claim("c1", "Google authentication")], [repository, website], "c1");
    expect(check?.status).toBe("supported");
    expect(check?.evidenceRefs).toContain("GitHub: src/auth/login.ts");
    expect(check?.evidenceRefs?.some((ref) => ref.startsWith("Deployed page:"))).toBe(true);
    expect(check?.note).toMatch(/shows this directly/i);
    // Inference is disclosed: the judge can tell a signal match from a quote.
    expect(check?.note).toMatch(/authentication signal/i);
  });

  it("stays partial when the claim adds detail the evidence does not show", () => {
    const check = checkOf(
      [claim("c1", "Google authentication for farm managers")],
      [repository, website],
      "c1",
    );
    expect(check?.status).toBe("partially_supported");
    expect(check?.note).toMatch(/not found/i);
    expect(check?.evidenceRefs?.length).toBeGreaterThan(0);
  });

  it("never upgrades a placeholder stub to supported", () => {
    const check = checkOf(
      [claim("c1", "AI-powered recommendations")],
      [repository],
      "c1",
    );
    expect(check?.status).toBe("partially_supported");
    expect(check?.note).toMatch(/placeholder|unfinished stub/i);
    expect(check?.evidenceRefs).toContain("GitHub: src/lib/recommendations.ts");
  });

  it("reports a claim with no evidence at all as not found", () => {
    const check = checkOf(
      [claim("c1", "The model uses machine learning to predict crop disease")],
      [repository, website],
      "c1",
    );
    expect(check?.status).toBe("not_found");
    expect(check?.note).toMatch(/not proof that the claim is false/i);
    expect(check?.evidenceRefs).toContain("GitHub: farmlens/web");
  });

  it("keeps stack claims strict: present names verify, absent names do not", () => {
    const [react, tensorflow] = compareClaims(
      [claim("c1", "React"), claim("c2", "TensorFlow")],
      [repository],
    );
    expect(react?.status).toBe("supported");
    expect(tensorflow?.status).toBe("not_found");
  });

  it("never turns unreadable evidence into a negative finding", () => {
    const [check] = compareClaims([claim("c1", "Google authentication")], unreadable);
    expect(check?.status).toBe("could_not_verify");
    expect(check?.note).toMatch(/not contradicted/i);
  });

  it("does not let the deck verify its own claims", () => {
    const [check] = compareClaims([claim("c1", "Google authentication")], [deck]);
    expect(check?.status).toBe("could_not_verify");
    expect(check?.sources).toEqual([]);
  });
});

describe("claims a judge cannot decide from code", () => {
  it("classifies marketing and impact statements", () => {
    expect(claimNatureOf("Seamless and world-class experience")).toBe("subjective");
    expect(claimNatureOf("Changes the world for farming communities")).toBe("unmeasurable");
    expect(claimNatureOf("We implemented Google authentication")).toBe("checkable");
  });

  it("reports them as judgement calls, never as missing features", () => {
    const verdict = checkOf(
      [
        { ...claim("c1", "Seamless and world-class experience"), nature: "subjective" },
        { ...claim("c2", "Changes the world for farming communities"), nature: "unmeasurable" },
      ],
      [repository, website],
      "c2",
    );
    expect(verdict?.status).toBe("could_not_verify");
    expect(verdict?.note).toMatch(/needs your own judgement/i);
    expect(verdict?.note).toMatch(/not counted as a missing feature/i);
  });

  it("extracts the same nature when claims come from the deck", () => {
    const claims = claimsFromSubmission({
      name: "FarmLens",
      presentation: {
        name: "farmlens.pptx",
        text: "FarmLens deck",
        claims: {
          features: ["Seamless and world-class experience", "Google authentication"],
          method: "heuristic",
        },
      },
    });
    expect(claims.find((entry) => entry.claim.includes("Seamless"))?.nature).toBe("subjective");
    expect(claims.find((entry) => entry.claim.includes("Google"))?.nature).toBe("checkable");
  });
});

describe("duplicate claims", () => {
  it("collapses the same claim said twice but keeps genuinely different ones", () => {
    expect(isNearDuplicateClaim("Google authentication", "Google authentication")).toBe(true);
    expect(
      isNearDuplicateClaim("Google authentication", "Google authentication for farm managers"),
    ).toBe(true);
    expect(isNearDuplicateClaim("React", "React Native")).toBe(false);
    expect(isNearDuplicateClaim("We use React", "We use TensorFlow")).toBe(false);

    const claims = claimsFromSubmission({
      name: "FarmLens",
      description: "Google authentication for everyone",
      technologies: ["React", "React", "React Native"],
      presentation: {
        name: "farmlens.pptx",
        text: "FarmLens deck",
        claims: {
          features: ["Google authentication", "Google authentication"],
          method: "heuristic",
        },
      },
    });
    expect(claims.filter((entry) => entry.claim === "React")).toHaveLength(1);
    expect(claims.filter((entry) => entry.claim.startsWith("Google authentication"))).toHaveLength(
      1,
    );
    expect(claims.filter((entry) => entry.claim === "React Native")).toHaveLength(1);
    expect(claims.length).toBeLessThanOrEqual(24);
  });
});

describe("README claims", () => {
  it("extracts README statements as claims and verifies them against the code", () => {
    const readmeClaims = claimsFromDocumentation([repository]);
    const authClaim = readmeClaims.find((entry) => entry.claim.includes("Google authentication"));
    expect(authClaim).toBeDefined();
    expect(authClaim?.id.startsWith("readme.")).toBe(true);

    // Verified by the implementation, not by the README that states it.
    const [check] = compareClaims([authClaim as ClaimInput], [repository]);
    expect(check?.status).toBe("supported");
    expect(check?.evidenceRefs).toContain("GitHub: src/auth/login.ts");
    // The README that states it is never cited as the proof.
    expect(check?.evidenceRefs).not.toContain("GitHub: README.md");
  });

  it("leaves a README-only claim unverified when no code backs it", () => {
    const readmeOnly: IngestionOutcome = {
      kind: "repository",
      status: "ingested",
      detail: "Repository inspected.",
      url: "https://github.com/farmlens/web",
      facts: [],
      text: "Repository: farmlens/web",
      observations: [],
      segments: [
        {
          ref: "GitHub: farmlens/web file list",
          kind: "implementation",
          text: "package.json\nsrc/app.tsx",
        },
        {
          ref: "GitHub: README.md",
          kind: "documentation",
          text: "# FarmLens\n- Supports Google authentication and offline sync.",
        },
      ],
    };
    const readmeClaims = claimsFromDocumentation([readmeOnly]);
    const claimEntry = readmeClaims.find((entry) => entry.claim.includes("offline sync"));
    expect(claimEntry).toBeDefined();

    const [check] = compareClaims([claimEntry as ClaimInput], [readmeOnly]);
    expect(check?.status).toBe("not_found");
  });
});

describe("end to end: deck claims → verdicts", () => {
  const submission = {
    name: "FarmLens",
    description: "FarmLens helps farmers act on climate risk.",
    repoUrl: "https://github.com/farmlens/web",
    websiteUrl: "https://farmlens.example.com",
    technologies: ["React", "TensorFlow"],
    presentation: {
      name: "farmlens.pptx",
      text: "FarmLens deck",
      claims: {
        features: [
          "Google authentication",
          "AI-powered recommendations",
          "Supports crop disease prediction",
        ],
        technology: ["React", "TensorFlow"],
        impact: ["Seamless experience for every farm"],
        method: "heuristic" as const,
      },
      pages: [
        { page: 3, text: "Features\nGoogle authentication and AI-powered recommendations" },
        { page: 9, text: "Impact\nSeamless experience for every farm" },
      ],
    },
  };

  it("gives every realistic claim the right status, evidence and page", () => {
    const bundle = buildEvidenceBundle(submission, [repository, website, deck]);
    const statusOf = (text: string) =>
      bundle.claims.find((entry) => entry.claim === text)?.status;

    expect(statusOf("Google authentication")).toBe("supported");
    expect(statusOf("AI-powered recommendations")).toBe("partially_supported");
    expect(statusOf("Supports crop disease prediction")).toBe("not_found");
    expect(statusOf("React")).toBe("supported");
    expect(statusOf("TensorFlow")).toBe("not_found");
    expect(statusOf("Seamless experience for every farm")).toBe("could_not_verify");

    const auth = bundle.claims.find((entry) => entry.claim === "Google authentication");
    expect(auth?.pageRefs).toEqual([3]);
    expect(auth?.evidenceRefs).toContain("GitHub: src/auth/login.ts");

    // Counts add up: no verdict is left undecided or double counted.
    const total = Object.values(bundle.counts).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(bundle.claims.length);
    expect(bundle.counts.could_not_verify).toBeGreaterThan(0);
    expect(bundle.sources[0]?.kind).toBe("submission");
  });
});
