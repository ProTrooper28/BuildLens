/**
 * Judge copilot — evidence-based questions and candidate-safe suggestions.
 *
 * Two audiences, one evidence base, deliberately different outputs:
 *
 *   QUESTIONS TO ASK   for the judge: 3–5 high-value questions, each tied to
 *                      something BuildLens actually observed or failed to find.
 *   IMPROVEMENT        for the candidate: actionable fixes, never judge notes,
 *   SUGGESTIONS        never a private score, never an accusation.
 *
 * Both are pure functions of the persisted report view, so they survive a
 * refresh, match what the judge is looking at, and cannot invent a finding.
 */

import type { Claim, ReportView } from "@/lib/report-data";
import type {
  ImprovementSuggestion,
  JudgeQuestion,
  JudgeQuestionPriority,
} from "@/types/evaluation";

/** Claims worth asking about: made by the team, not backed by evidence. */
function unverifiedClaims(view: ReportView): Claim[] {
  return view.claims
    .filter((claim) => !claim.verified)
    .filter((claim) => !/^(team|hackathon|category)\b/i.test(claim.claim.trim()))
    .filter((claim) => claim.claim.trim().length >= 3);
}

function claimEvidence(claim: Claim): string {
  const where = claim.sourceLocation ?? claim.source ?? "the submission";
  const reason = claim.reason ?? claim.evidence ?? "no matching implementation or deployed feature was found";
  return `${where}: “${claim.claim}” — ${reason}`;
}

function failingVitals(view: ReportView) {
  return [...view.performance.vitals, ...(view.website?.vitals ?? [])].filter(
    (vital) => vital.value !== null && vital.good === false,
  );
}

function securityFindings(view: ReportView) {
  return view.security.findings.filter(
    (finding) => finding.severity === "critical" || finding.severity === "high",
  );
}

const PRIORITY_RANK: Record<JudgeQuestionPriority, number> = { high: 0, medium: 1, low: 2 };

/**
 * 3–5 questions a judge can actually ask, strongest first.
 *
 * Every question quotes the evidence it came from. When there is nothing worth
 * asking, the list is empty — an invented question is worse than none.
 */
export function buildJudgeQuestions(view: ReportView): JudgeQuestion[] {
  const questions: JudgeQuestion[] = [];
  const add = (question: Omit<JudgeQuestion, "status" | "note" | "source">) => {
    if (questions.some((entry) => entry.id === question.id)) return;
    questions.push({ ...question, source: "evidence", status: "pending", note: null });
  };

  const claims = unverifiedClaims(view);

  // Contradicted / unsupported claims first: they are the ones a judge must resolve.
  const contradicted = claims.filter((claim) => /contradict/i.test(claim.status ?? ""));
  const unsupported = claims.filter((claim) => /unsupported|not_found|not supported/i.test(claim.status ?? ""));

  for (const [index, claim] of [...contradicted, ...unsupported].slice(0, 2).entries()) {
    add({
      id: `claim.${index}`,
      category: "claim",
      priority: "high",
      question: `Your submission says “${claim.claim.trim()}”. ${
        contradicted.includes(claim)
          ? "The evidence that was read conflicts with that."
          : "No matching implementation or deployed feature was found."
      } Can you show where it works?`,
      why: "A judge cannot verify a claim from the presentation alone, and an unsupported claim is the most common reason a score drops.",
      evidence: claimEvidence(claim),
    });
  }

  for (const [index, finding] of securityFindings(view).slice(0, 1).entries()) {
    add({
      id: `security.${index}`,
      category: "security",
      priority: "high",
      question: `The analysis flagged “${finding.title}”. How is that handled in the version you would ship?`,
      why: "Security findings are the highest-impact risk in a live product, and the fix is usually a process the team can describe.",
      evidence: finding.detail ?? finding.title,
    });
  }

  for (const [index, vital] of failingVitals(view).slice(0, 1).entries()) {
    const threshold = vital.threshold !== null ? ` (recommended under ${vital.threshold} ${vital.unit})` : "";
    add({
      id: `performance.${index}`,
      category: "performance",
      priority: "medium",
      question: `Your ${vital.name.toUpperCase()} measured ${vital.value} ${vital.unit}${threshold}. What have you tried to improve first render?`,
      why: "A measured metric is a concrete, fair thing to probe — it separates a performance-aware team from one that has not looked.",
      evidence: `${vital.name}: ${vital.value} ${vital.unit}${threshold}`,
    });
  }

  if (view.website?.url && !view.website.status) {
    add({
      id: "deployment.unreachable",
      category: "functionality",
      priority: "medium",
      question: `The deployed URL (${view.website.url}) could not be read during analysis. Is there a working link we can open?`,
      why: "Without a reachable deployment, every live claim is unverified — the team may simply have a broken environment.",
      evidence: `Deployment not reachable: ${view.website.url}`,
    });
  }

  if (view.repository && view.repository.hasTests === false) {
    add({
      id: "technical.tests",
      category: "technical",
      priority: "low",
      question: "No automated tests were found in the repository. How do you check that a change has not broken the core flow?",
      why: "It reveals whether correctness is engineered or only demonstrated once, without penalising a hackathon-sized project.",
      evidence: "No test files were found in the repository listing.",
    });
  }

  if (view.documentAnalysis && (view.documentAnalysis.totalPages ?? 0) > 0) {
    const scanned = view.documentAnalysis.ocrApplied;
    if (scanned) {
      add({
        id: "product.ocr",
        category: "product",
        priority: "low",
        question: "Part of your deck was image-only and had to be read with OCR. Can you walk us through the slides that matter most?",
        why: "OCR can misread content, so the judge should confirm the team's own wording rather than score a machine transcription.",
        evidence: `${view.documentAnalysis.fileName ?? "Deck"} — OCR applied`,
      });
    }
  }

  return questions
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    .slice(0, 5);
}

/**
 * Candidate-facing, actionable suggestions.
 *
 * Never includes judge notes, scores or accusations: each entry is a problem the
 * evidence shows, why it matters to a user, and what to do about it.
 */
export function buildImprovementSuggestions(view: ReportView): ImprovementSuggestion[] {
  const suggestions: ImprovementSuggestion[] = [];
  const add = (entry: ImprovementSuggestion) => {
    if (suggestions.some((existing) => existing.id === entry.id)) return;
    suggestions.push(entry);
  };

  const claims = unverifiedClaims(view);
  if (claims.length > 0) {
    const named = claims.slice(0, 2).map((claim) => `“${claim.claim.trim()}”`).join(", ");
    add({
      id: "claims.evidence",
      area: "Claim clarity",
      problem: `${claims.length} claim${claims.length === 1 ? "" : "s"} could not be independently verified, including ${named}.`,
      why: "A judge can only credit what they can see working, so an unverified feature reads as an aspiration rather than a build.",
      recommendation:
        "Add a short demo link, screenshot or file reference for each claimed feature, and say plainly which parts are still prototypes.",
    });
  }

  const security = securityFindings(view);
  if (security.length > 0) {
    add({
      id: "security.review",
      area: "Security",
      problem: security[0]!.title,
      why: security[0]!.detail ?? "Exposed configuration is the fastest way to lose a working deployment after judging.",
      recommendation:
        "Rotate any credential that was committed, move keys into environment variables, and check the deployed configuration for the same exposure.",
    });
  }

  const vitals = failingVitals(view);
  if (vitals.length > 0) {
    const vital = vitals[0]!;
    add({
      id: "performance.vitals",
      area: "Performance",
      problem: `${vital.name.toUpperCase()} is ${vital.value} ${vital.unit}${
        vital.threshold !== null ? ` (recommended under ${vital.threshold} ${vital.unit})` : ""
      }.`,
      why: "Users experience the slow first render before they see any of the product's value.",
      recommendation:
        "Optimise above-the-fold assets, compress images and defer non-critical JavaScript so the first screen renders sooner.",
    });
  }

  if (view.website?.url && !view.website.status) {
    add({
      id: "deployment.link",
      area: "Deployment",
      problem: "The submitted deployment could not be opened during analysis.",
      why: "An unreachable link turns every live claim into an unverified one, regardless of how well the product works locally.",
      recommendation:
        "Re-deploy, check the link in a private window, and update the submission with a URL that loads without signing in.",
    });
  }

  if (view.repository && view.repository.hasTests === false) {
    add({
      id: "technical.tests",
      area: "Engineering",
      problem: "No automated tests were found in the repository.",
      why: "Without tests, a small change can silently break the flow you demoed.",
      recommendation:
        "Add a handful of tests around the core workflow — they do not need to be exhaustive to be useful.",
    });
  }

  if (view.documentAnalysis && (view.documentAnalysis.totalPages ?? 0) === 0) {
    add({
      id: "documentation.deck",
      area: "Documentation",
      problem: "The submitted presentation did not yield a readable structure.",
      why: "A deck that machines and judges cannot parse hides the product's story.",
      recommendation:
        "Use real text instead of text baked into images, and add slide titles that name the problem, the solution and the evidence.",
    });
  }

  return suggestions.slice(0, 4);
}

/** Merge stored question state (asked / answered / notes) with a fresh generation. */
export function mergeQuestionState(
  generated: readonly JudgeQuestion[],
  stored: readonly JudgeQuestion[] | null | undefined,
): JudgeQuestion[] {
  const saved = new Map((stored ?? []).map((question) => [question.id, question]));
  const merged = generated.map((question) => {
    const previous = saved.get(question.id);
    if (!previous) return question;
    return {
      ...question,
      status: previous.status,
      note: previous.note,
    };
  });
  // Judge-written questions are kept, in the order they were added.
  for (const question of stored ?? []) {
    if (question.source === "judge" && !merged.some((entry) => entry.id === question.id)) {
      merged.push(question);
    }
  }
  return merged;
}
