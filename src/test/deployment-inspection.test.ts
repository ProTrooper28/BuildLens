/**
 * Priority 4 — the deployed application inspector.
 *
 * The structured deployment result is what a judge reads to decide whether a
 * project works, so these tests pin down the three things that matter:
 *
 *   • the measurements come from what the reader recorded (status, timing,
 *     redirects, resources) and nothing is filled in;
 *   • a check that could not run says so, with a basis that never reads as a pass;
 *   • a project type that needs no website is not penalised for having none.
 */

import { describe, expect, it } from "vitest";

import {
  CLAIM_STATUS_DISCLAIMER,
  type EvidenceBundle,
  type EvidenceObservation,
} from "@/services/evidence/types";
import { buildInspectionReport } from "@/services/inspection";
import type { ProjectDetail } from "@/types/evaluation";

const project: ProjectDetail = {
  id: "project:1",
  category: "project",
  source: "workspace",
  name: "AquaSense",
  subtitle: null,
  description: "Smart irrigation for farmers.",
  tags: ["React"],
  yearsExperience: null,
  projectCategory: "Submitted",
  createdAt: "2026-02-01T00:00:00.000Z",
  team: "Team Aqua",
  problemStatement: null,
  solution: "A React dashboard with a soil-moisture model.",
  technologies: ["React", "TypeScript"],
  repoUrl: "https://github.com/acme/aquasense",
  demoUrl: "https://aquasense.example.com",
  media: [],
  teamMembers: [],
  submitted: [],
  presentationClaims: null,
};

function obs(overrides: Partial<EvidenceObservation> & { id: string }): EvidenceObservation {
  return {
    area: "accessibility",
    label: "Check",
    status: "good",
    result: "The check ran.",
    evidence: [],
    confidence: "high",
    ...overrides,
  };
}

/** What the website reader records for a page that loaded normally. */
function siteObservations(): EvidenceObservation[] {
  return [
    obs({
      id: "site.accessibility.reachable",
      label: "Deployed site reachable",
      result: "The deployed site answered the request and served a page at aquasense.example.com.",
      evidence: ["Requested https://aquasense.example.com", "HTTP 200 in 420ms"],
    }),
    obs({
      id: "site.accessibility.https",
      label: "HTTPS / TLS",
      result: "The site is served over HTTPS.",
      evidence: ["Final URL: https://aquasense.example.com/"],
    }),
    obs({
      id: "site.accessibility.status",
      label: "Landing page responds",
      result: "The landing page answered HTTP 200 in 420ms.",
      evidence: ["HTTP 200 from aquasense.example.com", "Total time 420ms"],
    }),
    obs({
      id: "site.accessibility.redirects",
      label: "Redirects",
      result: "The submitted URL is the final URL — no redirect chain.",
      evidence: ["200 https://aquasense.example.com/"],
    }),
    obs({
      id: "site.functionality.content",
      area: "functionality",
      label: "Landing page content",
      result: "412 words of visible text were delivered in the HTML.",
    }),
    obs({
      id: "site.functionality.links",
      area: "functionality",
      label: "Links on the landing page",
      result: "2 same-origin links responded normally.",
      evidence: [
        "https://aquasense.example.com/about — 200",
        "https://aquasense.example.com/pricing — 200",
      ],
    }),
    obs({
      id: "site.performance.response",
      area: "performance",
      label: "Initial response time",
      result: "The server answered the page request in 420ms (measured once from BuildLens).",
      evidence: ["HTTP 200 in 420ms", "Threshold flag: >2500ms is slow"],
    }),
    obs({
      id: "site.performance.failed_resources",
      area: "performance",
      label: "Failed resources",
      result: "All 3 sampled resources responded normally.",
      evidence: [],
    }),
    obs({
      id: "site.performance.large_assets",
      area: "performance",
      label: "Large assets",
      status: "warning",
      result: "1 sampled resource is larger than 500 KB.",
      evidence: ["https://aquasense.example.com/assets/hero.png — 812 KB"],
    }),
    obs({
      id: "site.security.secrets",
      area: "security",
      label: "Secrets in public assets",
      status: "not_detected",
      result: "No obvious exposed secrets were detected in the served HTML and inline scripts.",
    }),
    obs({
      id: "site.security.headers",
      area: "security",
      label: "Security headers",
      status: "warning",
      result: "1 of 3 commonly checked security headers were present; 2 were not sent.",
      evidence: [
        "content-security-policy: not sent",
        "x-frame-options: not sent",
        "x-content-type-options: nosniff",
      ],
    }),
    obs({
      id: "site.security.server_side",
      area: "security",
      label: "Server-side vulnerabilities",
      status: "could_not_verify",
      result:
        "Server-side security cannot be verified from a public page load. This is not a pass.",
    }),
    obs({
      id: "site.ux.viewport",
      area: "ux",
      label: "Mobile viewport",
      result: "A responsive viewport meta tag is present.",
      evidence: ["viewport: width=device-width, initial-scale=1"],
    }),
  ];
}

function bundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    generatedAt: "2026-02-01T00:00:00.000Z",
    sources: [
      {
        kind: "document",
        label: "Submitted deck",
        status: "ingested",
        readable: true,
        url: null,
        detail: "Presentation text extracted (7 pages, native text).",
        highlights: ["7 pages with text"],
      },
      {
        kind: "repository",
        label: "GitHub repository",
        status: "ingested",
        readable: true,
        url: "https://github.com/acme/aquasense",
        detail: "Repository acme/aquasense was inspected.",
        highlights: ["Frameworks detected: React."],
        observations: [
          obs({
            id: "repo.code.auth",
            area: "repository",
            label: "Authentication implementation",
            result: "Authentication code was found (src/auth/session.ts).",
            evidence: ["src/auth/session.ts"],
          }),
        ],
      },
      {
        kind: "website",
        label: "Deployed website",
        status: "ingested",
        readable: true,
        url: "https://aquasense.example.com/",
        detail: "The deployed page returned HTTP 200.",
        highlights: ["HTTP 200"],
        observations: siteObservations(),
      },
    ],
    claims: [
      {
        id: "deck.feature.0",
        claim: "Sign in with Google for farm managers",
        category: "features",
        status: "supported",
        sources: ["repository", "website"],
        quotes: ["Authentication code was found (src/auth/session.ts)."],
        note: "The repository contains the authentication flow this claim describes.",
        kind: "features",
        pageRefs: [7],
        evidenceRefs: [
          "GitHub: src/auth/session.ts",
          "Deployed page: https://aquasense.example.com/",
        ],
      },
      {
        id: "deck.impact.0",
        claim: "Used by 12 farms in Kenya",
        category: "impact",
        status: "could_not_verify",
        sources: [],
        quotes: [],
        note: "Could not verify: no source with usage data was provided.",
        kind: "general",
      },
    ],
    gaps: [],
    counts: { supported: 1, partially_supported: 0, not_found: 0, could_not_verify: 1 },
    disclaimer: CLAIM_STATUS_DISCLAIMER,
    ...overrides,
  };
}

describe("structured deployment inspection", () => {
  it("reports the HTTP facts the reader actually recorded", () => {
    const report = buildInspectionReport({ detail: project, bundle: bundle(), evaluation: null });
    const deployment = report.verdict.deployment;

    expect(deployment.applicable).toBe(true);
    expect(deployment.http.status).toBe(200);
    expect(deployment.http.https).toBe(true);
    expect(deployment.http.responseMs).toBe(420);
    expect(deployment.http.redirects).toBe(0);
    expect(deployment.http.finalUrl).toBe("https://aquasense.example.com/");

    const availability = deployment.rows.find((row) => row.id === "availability")!;
    expect(availability.status).toBe("good");
    expect(availability.value).toBe("Online");
    expect(deployment.rows.find((row) => row.id === "response")!.value).toBe("200 OK");
  });

  it("groups the findings into the five areas, with a basis on each check", () => {
    const report = buildInspectionReport({ detail: project, bundle: bundle(), evaluation: null });
    const deployment = report.verdict.deployment;

    expect(deployment.areas.map((area) => area.id)).toEqual([
      "availability",
      "functionality",
      "performance",
      "security",
      "responsiveness",
    ]);

    const performance = deployment.areas.find((area) => area.id === "performance")!;
    const response = performance.checks.find((check) => check.id === "site.performance.response")!;
    expect(response.value).toBe("420 ms");
    expect(response.basis).toBe("observed");
    expect(
      performance.checks.find((check) => check.id === "site.performance.failed_resources")!.value,
    ).toBe("0 failed");
    expect(
      performance.checks.find((check) => check.id === "site.performance.large_assets")!.status,
    ).toBe("warning");

    const security = deployment.areas.find((area) => area.id === "security")!;
    const serverSide = security.checks.find((check) => check.id === "site.security.server_side")!;
    expect(serverSide.basis).toBe("could_not_verify");
    // "Not detected" is never presented as "secure".
    expect(security.checks.find((check) => check.id === "site.security.secrets")!.basis).toBe(
      "not_detected",
    );
    expect(deployment.rows.find((row) => row.id === "security")!.value).toBe(
      "Some headers missing",
    );

    expect(deployment.routes).toHaveLength(2);
    expect(deployment.resources.join(" ")).toMatch(/hero\.png/);
  });

  it("never fills in a measurement when the site could not be read", () => {
    const unreachable = bundle({
      sources: [
        {
          kind: "website",
          label: "Deployed website",
          status: "failed",
          readable: false,
          url: "https://aquasense.example.com",
          detail:
            "aquasense.example.com could not be inspected (fetch failed). Website claims are unverified — this is not evidence that the site is missing.",
          highlights: [],
          observations: [
            obs({
              id: "site.accessibility.reachable",
              status: "could_not_verify",
              label: "Deployed site reachable",
              result:
                "The deployed site did not answer the public request, so nothing could be inspected.",
              evidence: ["aquasense.example.com: fetch failed"],
            }),
          ],
        },
      ],
      claims: [],
      counts: { supported: 0, partially_supported: 0, not_found: 0, could_not_verify: 0 },
    });

    const report = buildInspectionReport({
      detail: project,
      bundle: unreachable,
      evaluation: null,
    });
    const deployment = report.verdict.deployment;

    expect(deployment.http.status).toBeNull();
    expect(deployment.http.responseMs).toBeNull();
    expect(deployment.http.https).toBeNull();
    expect(deployment.rows.find((row) => row.id === "availability")!.status).toBe(
      "could_not_verify",
    );
    expect(deployment.rows.find((row) => row.id === "performance")!.value).toBe("Not measured");
    expect(deployment.areas).toHaveLength(1);
    expect(deployment.limitations).toEqual([]);
  });

  it("does not penalise a non-web project for having no deployed URL", () => {
    const mobile: ProjectDetail = {
      ...project,
      description: "A Flutter app for farm workers",
      demoUrl: null,
      technologies: ["Flutter"],
    };
    const report = buildInspectionReport({
      detail: mobile,
      bundle: bundle({
        sources: bundle().sources.filter((source) => source.kind !== "website"),
      }),
      evaluation: null,
    });

    expect(report.projectType).toBe("mobile_app");
    const deployment = report.verdict.deployment;
    expect(deployment.applicable).toBe(false);
    expect(deployment.areas).toEqual([]);
    expect(deployment.rows.find((row) => row.id === "availability")!.value).toBe("Not checked");
    expect(deployment.limitations.join(" ")).toMatch(/does not require a deployed website/i);
    expect(report.verdict.missingInputs.join(" ")).not.toMatch(/deployed URL/i);
  });

  it("shows which source carried each claim", () => {
    const report = buildInspectionReport({ detail: project, bundle: bundle(), evaluation: null });
    const claims = report.sections.find((section) => section.id === "claims")!;

    const supported = claims.checks.find((check) => check.id === "claim:deck.feature.0")!;
    const cross = supported.crossChecks ?? [];
    expect(cross.find((entry) => entry.source === "Repository")!.status).toBe("supported");
    expect(cross.find((entry) => entry.source === "Deployment")!.status).toBe("supported");
    // The deck is where the claim came from, so it never counts as its own proof.
    expect(cross.find((entry) => entry.source === "Document")!.status).toBe("could_not_verify");
    expect(cross.find((entry) => entry.source === "Document")!.detail).toMatch(
      /does not count as proof/i,
    );
    expect(cross.find((entry) => entry.source === "Deployment")!.detail).toMatch(/Deployed page:/);

    // Nothing was read for this claim anywhere: it must not gain support.
    const unchecked = claims.checks.find((check) => check.id === "claim:deck.impact.0")!;
    expect(unchecked.crossChecks?.every((entry) => entry.status === "could_not_verify")).toBe(true);
  });
});
