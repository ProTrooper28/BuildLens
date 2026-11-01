import { AlertTriangle, Bot, CheckCircle2, Info, Lightbulb, Search, XCircle } from "lucide-react";
import { motion } from "framer-motion";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeading } from "@/components/evaluation/shared";
import { cn } from "@/lib/utils";
import type { SubmissionDetail } from "@/types/evaluation";
import type { ReportView } from "@/lib/report-data";

/**
 * AI Verdict Panel - displayed inside the judge evaluation screen and report pages.
 *
 * Explicitly labelled as AI-generated analysis to prevent confusion with
 * the judge's final human decision.
 *
 * Sections:
 *  - Overall assessment
 *  - Key strengths
 *  - Key weaknesses / risks
 *  - Evidence notes (what is verifiable vs. claimed)
 *  - Recommended areas for judge attention
 */

export interface AiVerdictData {
  overallAssessment: string;
  strengths: string[];
  weaknesses: string[];
  evidenceNotes: EvidenceNote[];
  judgeAttentionAreas: string[];
  confidence: "high" | "medium" | "low";
  analysisSource: "submission_fields" | "ai_model";
  modelLabel?: string | null;
}

export interface EvidenceNote {
  claim: string;
  status: "verified" | "unverified" | "missing";
  note: string | null;
}

/** Derives a verdict from submission fields alone - no LLM required. */
export function deriveVerdictFromSubmission(detail: SubmissionDetail): AiVerdictData {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const evidenceNotes: EvidenceNote[] = [];
  const judgeAttentionAreas: string[] = [];

  if (detail.category === "resume") {
    const resume = detail;

    if (resume.experience.length > 0) {
      strengths.push(`${resume.experience.length} work experience entries documented`);
    } else {
      weaknesses.push("No work experience documented");
      judgeAttentionAreas.push("Verify employment history through other means");
    }

    if (resume.skills.length > 0) {
      strengths.push(
        `Technical skills list: ${Math.min(resume.skills.length, 5)} skills shown${resume.skills.length > 5 ? ` (+${resume.skills.length - 5} more)` : ""}`,
      );
      evidenceNotes.push({
        claim: "Technical skills",
        status: "unverified",
        note: "Skills are self-reported; judge should verify depth during evaluation",
      });
    } else {
      weaknesses.push("No skills explicitly listed");
    }

    if (resume.projects.length > 0) {
      strengths.push(`${resume.projects.length} project(s) documented`);
      evidenceNotes.push({
        claim: "Project work",
        status: "unverified",
        note: "Project details are self-reported. Check for GitHub links or live demos",
      });
    } else {
      weaknesses.push("No projects documented in submission");
      judgeAttentionAreas.push("Ask candidate about portfolio projects");
    }

    if (resume.education.length > 0) {
      strengths.push("Education history documented");
    }

    if (resume.achievements.length > 0) {
      strengths.push(`${resume.achievements.length} achievement(s) listed`);
      evidenceNotes.push({
        claim: "Achievements / awards",
        status: "unverified",
        note: "Achievements are self-reported and should be verified with the candidate",
      });
    }

    if (resume.links.length > 0) {
      strengths.push("External links provided (GitHub, portfolio, etc.)");
      judgeAttentionAreas.push("Review linked profiles and repositories before scoring");
    } else {
      weaknesses.push("No external links (GitHub, portfolio) provided");
      judgeAttentionAreas.push("Request GitHub or portfolio URL from candidate");
    }

    if (resume.summary) {
      strengths.push("Candidate summary / objective statement present");
    } else {
      weaknesses.push("No candidate summary or objective statement");
    }

    const completeness =
      (strengths.length / Math.max(strengths.length + weaknesses.length, 1)) * 100;
    return {
      overallAssessment:
        completeness >= 70
          ? "This resume is reasonably complete. The submission contains multiple documented sections allowing meaningful evaluation."
          : completeness >= 40
            ? "This resume is partially complete. Some sections are present but notable gaps exist that the judge should probe."
            : "This resume is sparse. Critical sections are missing. The judge should seek clarification before scoring.",
      strengths,
      weaknesses,
      evidenceNotes,
      judgeAttentionAreas,
      confidence: completeness >= 70 ? "high" : completeness >= 40 ? "medium" : "low",
      analysisSource: "submission_fields",
    };
  }

  // Project-specific analysis
  const project = detail;

  if (project.description) {
    strengths.push("Project description provided");
    evidenceNotes.push({
      claim: "Project purpose",
      status: "verified",
      note: "Description present in submission",
    });
  } else {
    weaknesses.push("No project description");
    judgeAttentionAreas.push("Ask team to clarify what the project does");
  }

  if (project.problemStatement) {
    strengths.push("Problem statement articulated");
    evidenceNotes.push({
      claim: "Problem definition",
      status: "verified",
      note: "Problem statement provided in submission",
    });
  } else {
    weaknesses.push("No problem statement - unclear what need the project addresses");
    judgeAttentionAreas.push("Verify the team understands the problem they are solving");
  }

  if (project.solution) {
    strengths.push("Solution description provided");
  } else {
    weaknesses.push("No solution description");
    judgeAttentionAreas.push("Probe the team on their technical approach");
  }

  if (project.repoUrl) {
    strengths.push("Repository URL provided");
    evidenceNotes.push({
      claim: "Repository exists",
      status: "unverified",
      note: "Link provided but content not inspected - judge should check repo quality",
    });
    judgeAttentionAreas.push(
      "Review repository: code quality, commit history, README completeness",
    );
  } else {
    weaknesses.push("No repository URL - code cannot be verified");
    evidenceNotes.push({
      claim: "Repository / source code",
      status: "missing",
      note: "No repository link provided. Technical implementation cannot be verified.",
    });
    judgeAttentionAreas.push("Request repository access before scoring technical criteria");
  }

  if (project.demoUrl) {
    strengths.push("Live demo URL provided");
    evidenceNotes.push({
      claim: "Live deployment",
      status: "unverified",
      note: "Demo link provided - judge should test it before evaluating UX/completeness",
    });
    judgeAttentionAreas.push("Test the live demo; check core features work");
  } else {
    weaknesses.push("No live demo - deployed functionality cannot be assessed");
    evidenceNotes.push({
      claim: "Live deployment",
      status: "missing",
      note: "No demo URL. Judge must rely on screenshots/video or repo alone.",
    });
  }

  if (project.technologies.length > 0) {
    strengths.push(
      `Technology stack listed: ${project.technologies.slice(0, 4).join(", ")}${project.technologies.length > 4 ? ` +${project.technologies.length - 4}` : ""}`,
    );
    evidenceNotes.push({
      claim: "Technology stack",
      status: "unverified",
      note: "Stack is self-reported; verify in repository code",
    });
  } else {
    weaknesses.push("Technology stack not listed");
  }

  if (project.teamMembers.length > 1) {
    strengths.push(`Team of ${project.teamMembers.length} members documented`);
    judgeAttentionAreas.push("Verify contribution balance across team members");
  }

  if (project.media.length > 0) {
    strengths.push(`${project.media.length} media item(s) attached (screenshots/video)`);
  } else {
    weaknesses.push("No screenshots or media attached");
    judgeAttentionAreas.push("Request screenshots or demo recording if no live demo available");
  }

  const completeness = (strengths.length / Math.max(strengths.length + weaknesses.length, 1)) * 100;

  return {
    overallAssessment:
      completeness >= 70
        ? "This submission is well-documented. The team has provided most required artifacts - judge can evaluate against rubric criteria with reasonable confidence."
        : completeness >= 40
          ? "This submission is partially documented. Key artifacts are missing; judge should probe the team before finalizing scores."
          : "This submission is sparse. Multiple critical sections are absent. The judge should gather additional evidence before scoring.",
    strengths,
    weaknesses,
    evidenceNotes,
    judgeAttentionAreas,
    confidence: completeness >= 70 ? "high" : completeness >= 40 ? "medium" : "low",
    analysisSource: "submission_fields",
  };
}

/** Derives an AI verdict from a full ReportView object. */
export function deriveVerdictFromReport(view: ReportView): AiVerdictData {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const evidenceNotes: EvidenceNote[] = [];
  const judgeAttentionAreas: string[] = [];

  // 1. Overall assessment
  let overallAssessment = "";
  if (view.scores.overall !== null) {
    if (view.scores.overall >= 75) {
      overallAssessment = `High-performing technical implementation (${view.scores.overall}/100) with verified capabilities and consistent architectural execution across evaluated dimensions.`;
    } else if (view.scores.overall >= 50) {
      overallAssessment = `Solid baseline implementation (${view.scores.overall}/100) demonstrating functional core elements, though key engineering, testing, or security areas warrant scrutiny.`;
    } else {
      overallAssessment = `Early-stage or sparse project (${view.scores.overall}/100) with limited evidence or notable gaps that require in-depth examination by judges.`;
    }
  } else if (view.overview.summary) {
    overallAssessment = `Automated evaluation: The project presents as ${view.overview.summary.toLowerCase().replace(/\.+$/, "")}, analyzed across repository and deployment artifacts.`;
  } else {
    overallAssessment =
      "Preliminary automated evaluation compiled from repository, deployment, and submission artifacts. No final score has been locked.";
  }

  // 2. Strengths
  for (const h of view.overview.highlights) {
    if (h && !strengths.includes(h)) strengths.push(h);
  }
  if (view.scores.codeQuality !== null && view.scores.codeQuality >= 70) {
    strengths.push(`Strong code quality score (${view.scores.codeQuality}/100)`);
  }
  if (view.scores.security !== null && view.scores.security >= 80) {
    strengths.push(`Robust security posture (${view.scores.security}/100)`);
  }
  if (view.scores.performance !== null && view.scores.performance >= 75) {
    strengths.push(`Solid runtime performance profile (${view.scores.performance}/100)`);
  }
  if (view.repository?.hasTests) {
    strengths.push(
      `Automated test suite configured in repository${view.repository.testCoveragePct !== null ? ` (~${view.repository.testCoveragePct}% coverage)` : ""}`,
    );
  }
  if (view.repository?.hasCI) {
    strengths.push("Continuous Integration (CI) pipeline verified active");
  }
  if (
    view.website?.status &&
    (view.website.status.includes("200") ||
      view.website.status.toLowerCase().includes("ok") ||
      view.website.status.toLowerCase().includes("live"))
  ) {
    strengths.push(`Live deployment active and verified at ${view.website.url ?? "target domain"}`);
  }
  for (const claim of view.claims) {
    if (claim.verified) {
      strengths.push(`Verified claim: ${claim.claim}`);
    }
  }
  if (view.architecture.decisions.length > 0) {
    strengths.push(`${view.architecture.decisions.length} documented architecture decision(s)`);
  }
  if (strengths.length === 0 && view.overview.techStack.length > 0) {
    strengths.push(
      `Documented technology stack: ${view.overview.techStack.slice(0, 4).join(", ")}`,
    );
  }

  // 3. Weaknesses / Risks
  for (const risk of view.risks) {
    const sevTag = risk.severity !== "unknown" ? `[${risk.severity.toUpperCase()}] ` : "";
    weaknesses.push(`${sevTag}${risk.title}${risk.detail ? ` — ${risk.detail}` : ""}`);
  }
  for (const claim of view.claims) {
    if (!claim.verified) {
      weaknesses.push(
        `Unverified claim: ${claim.claim}${claim.evidence ? ` (${claim.evidence})` : ""}`,
      );
    }
  }
  if (view.scores.testing !== null && view.scores.testing < 50) {
    weaknesses.push(
      `Low testing score (${view.scores.testing}/100) indicating sparse or missing automated tests`,
    );
  }
  if (view.scores.security !== null && view.scores.security < 60) {
    weaknesses.push(`Elevated security risk profile (${view.scores.security}/100)`);
  }
  if (view.repository && !view.repository.hasTests) {
    weaknesses.push("No automated test suite detected in source repository");
  }
  if (!view.website?.url) {
    weaknesses.push("No live deployment URL provided for runtime verification");
  }

  // 4. Evidence notes
  if (view.repository) {
    evidenceNotes.push({
      claim: "Source Repository",
      status: view.repository.url ? "verified" : "missing",
      note: view.repository.url
        ? `${view.repository.commits ?? 0} commits, ${view.repository.contributors ?? 1} contributor(s)${view.repository.license ? `, license: ${view.repository.license}` : ""}`
        : "No repository URL provided",
    });
  } else {
    evidenceNotes.push({
      claim: "Source Repository",
      status: "missing",
      note: "No repository inspection data available",
    });
  }

  if (view.website?.url) {
    evidenceNotes.push({
      claim: "Live Deployment",
      status: view.website.status ? "verified" : "unverified",
      note: view.website.status
        ? `Status: ${view.website.status}${view.website.pageWeightMb ? `, ${view.website.pageWeightMb}MB page weight` : ""}`
        : "Live URL specified but response could not be verified",
    });
  } else {
    evidenceNotes.push({
      claim: "Live Deployment",
      status: "missing",
      note: "No live web endpoint provided",
    });
  }

  for (const claim of view.claims) {
    evidenceNotes.push({
      claim: claim.claim,
      status: claim.verified ? "verified" : "unverified",
      note:
        claim.evidence ??
        (claim.verified
          ? "Verified via repository / automated analysis"
          : "Claim unverified against inspected code"),
    });
  }

  // 5. Judge attention areas
  for (const jq of view.judgeQuestions) {
    if (jq && !judgeAttentionAreas.includes(jq)) judgeAttentionAreas.push(jq);
  }
  for (const iq of view.interviewQuestions.slice(0, 3)) {
    if (iq && !judgeAttentionAreas.includes(iq))
      judgeAttentionAreas.push(`Interview prompt: ${iq}`);
  }
  for (const risk of view.risks.filter((r) => r.severity === "critical" || r.severity === "high")) {
    judgeAttentionAreas.push(
      `Probe critical risk: ${risk.title}${risk.mitigation ? ` (Proposed mitigation: ${risk.mitigation})` : ""}`,
    );
  }
  // Unverified claims are grouped into one line with examples. One warning per
  // claim turned a deck into a wall of noise and hid the real risks.
  const unverifiedClaims = view.claims.filter((claim) => !claim.verified);
  if (unverifiedClaims.length > 0) {
    const named = unverifiedClaims.slice(0, 3).map((claim) => `"${claim.claim}"`).join(", ");
    judgeAttentionAreas.push(
      unverifiedClaims.length === 1
        ? `Verify 1 unverified claim with the team: ${named}`
        : `Verify ${unverifiedClaims.length} unverified claims with the team: ${named}${unverifiedClaims.length > 3 ? `, +${unverifiedClaims.length - 3} more` : ""}`,
    );
  }
  for (const rec of view.recommendations.slice(0, 2)) {
    judgeAttentionAreas.push(`Recommendation check: ${rec.title}`);
  }
  if (judgeAttentionAreas.length === 0) {
    judgeAttentionAreas.push(
      "Review code architecture and evaluate against category rubric criteria.",
    );
  }

  const confidence: "high" | "medium" | "low" =
    view.hasPayloadData && (view.repository?.url != null || view.website?.url != null)
      ? "high"
      : view.hasPayloadData
        ? "medium"
        : "low";

  return {
    overallAssessment,
    strengths,
    weaknesses,
    evidenceNotes,
    judgeAttentionAreas,
    confidence,
    analysisSource: "ai_model",
    modelLabel: "BuildLens AI Analyst",
  };
}

const CONFIDENCE_META = {
  high: { label: "High confidence", className: "border-success/30 bg-success/10 text-success" },
  medium: { label: "Medium confidence", className: "border-warning/30 bg-warning/10 text-warning" },
  low: {
    label: "Low confidence",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
};

interface AiVerdictPanelProps {
  verdict: AiVerdictData;
  title?: string;
  className?: string;
}

export function AiVerdictPanel({ verdict, title = "AI Verdict", className }: AiVerdictPanelProps) {
  const confidenceMeta = CONFIDENCE_META[verdict.confidence];
  const verifiedCount = verdict.evidenceNotes.filter((n) => n.status === "verified").length;
  const missingCount = verdict.evidenceNotes.filter((n) => n.status === "missing").length;

  return (
    <Card className={cn("border-primary/20 bg-primary/[0.03] backdrop-blur", className)}>
      <CardHeader className="space-y-2 border-b border-primary/15 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary/70" aria-hidden />
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn("text-[10px] font-normal", confidenceMeta.className)}
            >
              {confidenceMeta.label}
            </Badge>
            <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
              {verdict.analysisSource === "ai_model"
                ? (verdict.modelLabel ?? "AI model")
                : "Submission analysis"}
            </Badge>
          </div>
        </div>
        <p className="rounded-md border border-primary/15 bg-primary/[0.06] px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
          <strong className="text-foreground">AI analysis only</strong> - this is not a score and
          does not replace your judgment. Use it to guide your evaluation, then score each criterion
          independently.
        </p>
      </CardHeader>

      <CardContent className="space-y-5 pt-5">
        <div>
          <SectionHeading className="mb-2">Overall assessment</SectionHeading>
          <p className="text-sm leading-relaxed text-foreground/85">{verdict.overallAssessment}</p>
        </div>

        {verdict.strengths.length > 0 && (
          <div>
            <SectionHeading className="mb-2">Key strengths</SectionHeading>
            <ul className="space-y-1.5">
              {verdict.strengths.map((strength, i) => (
                <motion.li
                  key={`strength-${i}`}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="flex items-start gap-2 text-xs text-foreground/80"
                >
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                  {strength}
                </motion.li>
              ))}
            </ul>
          </div>
        )}

        {verdict.weaknesses.length > 0 && (
          <div>
            <SectionHeading className="mb-2">Weaknesses / risks</SectionHeading>
            <ul className="space-y-1.5">
              {verdict.weaknesses.map((weakness, i) => (
                <motion.li
                  key={`weakness-${i}`}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="flex items-start gap-2 text-xs text-foreground/80"
                >
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                  {weakness}
                </motion.li>
              ))}
            </ul>
          </div>
        )}

        {verdict.evidenceNotes.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <SectionHeading>Evidence supporting assessment</SectionHeading>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {verifiedCount} verified · {missingCount} missing
              </span>
            </div>
            <ul className="space-y-2">
              {verdict.evidenceNotes.map((note, i) => (
                <li
                  key={`evidence-${i}`}
                  className="rounded-md border border-border/60 bg-background/40 px-2.5 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium">{note.claim}</span>
                    <EvidenceStatusBadge status={note.status} />
                  </div>
                  {note.note && (
                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                      {note.note}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {verdict.judgeAttentionAreas.length > 0 && (
          <div>
            <SectionHeading className="mb-2">Recommended areas for judge attention</SectionHeading>
            <ul className="space-y-1.5">
              {verdict.judgeAttentionAreas.map((area, i) => (
                <motion.li
                  key={`attention-${i}`}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="flex items-start gap-2 text-xs text-foreground/80"
                >
                  <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
                  {area}
                </motion.li>
              ))}
            </ul>
          </div>
        )}

        <p className="flex items-start gap-1.5 text-[10px] leading-snug text-muted-foreground/70">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          AI analysis is derived from the submission fields. It surfaces gaps and inconsistencies to
          guide your evaluation - the final score and recommendation are entirely your decision.
        </p>
      </CardContent>
    </Card>
  );
}

function EvidenceStatusBadge({ status }: { status: EvidenceNote["status"] }) {
  if (status === "verified") {
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-success/30 bg-success/10 text-[10px] font-normal text-success"
      >
        Verified
      </Badge>
    );
  }
  if (status === "missing") {
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-destructive/30 bg-destructive/10 text-[10px] font-normal text-destructive"
      >
        Missing
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="shrink-0 border-warning/30 bg-warning/10 text-[10px] font-normal text-warning"
    >
      Unverified
    </Badge>
  );
}

/** Compact version for use inside the ScoringPanel sidebar. */
export function AiVerdictCompact({
  verdict,
  className,
}: {
  verdict: AiVerdictData;
  className?: string;
}) {
  const confidenceMeta = CONFIDENCE_META[verdict.confidence];
  return (
    <div
      className={cn("rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2.5", className)}
    >
      <div className="flex items-center gap-2">
        <Bot className="h-3.5 w-3.5 text-primary/70" aria-hidden />
        <span className="text-xs font-medium">AI Pre-Assessment</span>
        <Badge
          variant="outline"
          className={cn("ml-auto text-[10px] font-normal", confidenceMeta.className)}
        >
          {confidenceMeta.label}
        </Badge>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-foreground/80">
        {verdict.overallAssessment}
      </p>
      {verdict.judgeAttentionAreas.length > 0 && (
        <div className="mt-2.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Attention areas
          </p>
          <ul className="space-y-1">
            {verdict.judgeAttentionAreas.slice(0, 3).map((area, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px] text-foreground/75">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden />
                {area}
              </li>
            ))}
            {verdict.judgeAttentionAreas.length > 3 && (
              <li className="text-[10px] text-muted-foreground">
                +{verdict.judgeAttentionAreas.length - 3} more
              </li>
            )}
          </ul>
        </div>
      )}
      <p className="mt-2.5 text-[10px] text-muted-foreground/70">
        AI analysis only - not a score or final decision.
      </p>
    </div>
  );
}

/** Inline teaser for inside the ScoringPanel (summary counts only). */
export function AiVerdictInline({
  verdict,
  className,
}: {
  verdict: AiVerdictData;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-primary/30 bg-primary/[0.03] px-3 py-2.5",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Search className="h-3.5 w-3.5" aria-hidden />
        AI submission analysis
        <Badge variant="outline" className="ml-auto text-[10px] font-normal">
          {verdict.analysisSource === "ai_model"
            ? (verdict.modelLabel ?? "AI model")
            : "Auto-derived"}
        </Badge>
      </div>
      <p className="mt-1 text-[11px] font-medium text-foreground/80">
        {verdict.overallAssessment.split(".")[0]}.
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
        {verdict.strengths.length} strength{verdict.strengths.length !== 1 ? "s" : ""},{" "}
        {verdict.weaknesses.length} weakness{verdict.weaknesses.length !== 1 ? "es" : ""},{" "}
        {verdict.judgeAttentionAreas.length} attention area
        {verdict.judgeAttentionAreas.length !== 1 ? "s" : ""}. See the full AI assessment below the
        scoring panel.
      </p>
    </div>
  );
}
