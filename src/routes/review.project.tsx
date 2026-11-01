import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Globe, Loader2, Ticket, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AppLayout } from "@/components/layout/AppLayout";
import { FileDrop, type FileDropStatus } from "@/components/FileDrop";
import {
  DocumentAnalysisPanel,
  type DocumentAnalysisPhase,
} from "@/components/review/DocumentAnalysisPanel";
import { EASE_OUT } from "@/components/motion/primitives";
import { SubmitButton, type SubmitButtonState } from "@/components/ui/submit-button";
import { MovingBorder } from "@/components/ui/moving-border";
import { useAuth } from "@/hooks/useAuth";
import { createProjectForUser } from "@/services/project.service";
import { createReportForUser } from "@/services/report.service";
import { createGuestProject, createGuestReport } from "@/services/guest.service";
import {
  findHackathonByCode,
  portalCandidateId,
  submitToHackathon,
  syncSubmissionProgress,
} from "@/services/hackathon.service";
import type { Hackathon } from "@/types/hackathon";
import {
  analyzeDocumentFile,
  documentAnalysisPayloadOf,
  type DocumentAnalysis,
} from "@/services/document";
import { notify } from "@/lib/toast-messages";
import { startProjectAnalysis } from "@/analysis/runner";
import { analysisPersistenceFor } from "@/analysis/persistence";
import type { AnalysisInput } from "@/analysis/types";
import type { Json } from "@/types/database";

export const Route = createFileRoute("/review/project")({
  head: () => ({
    meta: [
      { title: "Review Project — BuildLens" },
      {
        name: "description",
        content:
          "Submit a repository, live site and presentation for an evidence-based project review.",
      },
      { property: "og:title", content: "Review Project — BuildLens" },
      { property: "og:description", content: "Start an evidence-based project investigation." },
    ],
  }),
  component: ReviewProject,
});

function validateUrl(value: string) {
  if (!value) return true; // optional
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Attachment metadata carried into `report_data.attachments`. */
type Attachment = { name: string; size: number; type: string };

/** Inline validation message that slides in without shifting the layout. */
function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <motion.p
      id={id}
      role="alert"
      initial={{ opacity: 0, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
      className="flex items-center gap-1.5 text-xs font-medium text-destructive"
    >
      <AlertCircle className="h-3.5 w-3.5" />
      {children}
    </motion.p>
  );
}

function ReviewProject() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  // Submitted to the hackathon as `team_members`; optional for solo entries.
  const [members, setMembers] = useState("");
  // The team's own name; falls back to the project name when left empty.
  const [teamName, setTeamName] = useState("");
  // Optional: with a code the project is filed under that hackathon; without
  // one it waits as an unassigned submission for an organizer to file it.
  const [joinCode, setJoinCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [joining, setJoining] = useState(false);
  const [hackathon, setHackathon] = useState<Hackathon | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [repo, setRepo] = useState("");
  const [live, setLive] = useState("");
  const [notes, setNotes] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [deckStatus, setDeckStatus] = useState<FileDropStatus>("idle");
  const [videoStatus, setVideoStatus] = useState<FileDropStatus>("idle");
  const [deckFile, setDeckFile] = useState<File | null>(null);
  const [docPhase, setDocPhase] = useState<DocumentAnalysisPhase>("idle");
  const [docAnalysis, setDocAnalysis] = useState<DocumentAnalysis | null>(null);
  const docPromiseRef = useRef<Promise<void> | null>(null);
  const docAnalysisRef = useRef<DocumentAnalysis | null>(null);
  const [submitState, setSubmitState] = useState<SubmitButtonState>("idle");
  const errorResetTimer = useRef<number | null>(null);
  const busy = submitState === "submitting" || submitState === "processing";

  const { user, isGuest, isLoading: authLoading } = useAuth();

  const repoValid = validateUrl(repo);
  const liveValid = validateUrl(live);
  const nameValid = name.trim().length >= 2;

  const showRepoError = !!(touched["repo"] && !!repo && !repoValid);
  const showLiveError = !!(touched["live"] && !!live && !liveValid);
  const showNameError = !!(touched["name"] && !nameValid);

  const deckReady = deckStatus === "success";
  const videoReady = videoStatus === "success";
  void videoReady; // optional upload; tracked for future use

  // Guests may submit without an account; signed-in users need a session.
  // The hackathon code is deliberately absent: it is optional and never blocks.
  const canSubmit = useMemo(
    () => nameValid && repoValid && liveValid && deckReady && (isGuest || !!user),
    [nameValid, repoValid, liveValid, deckReady, isGuest, user],
  );

  const needs = [
    { key: "name", met: nameValid, text: "Project name (min 2 characters)" },
    { key: "url", met: repoValid && liveValid, text: "Repository and website URLs valid" },
    { key: "deck", met: deckReady, text: "Presentation uploaded" },
  ] as const;

  /** `Ada Lovelace, Grace Hopper` → `["Ada Lovelace", "Grace Hopper"]`. */
  const teamMembers = members
    .split(",")
    .map((member) => member.trim())
    .filter(Boolean)
    .slice(0, 12);

  const attachments: Attachment[] = deckFile
    ? [{ name: deckFile.name, size: deckFile.size, type: deckFile.type }]
    : [];

  /**
   * Resolve a typed code to the hackathon candidates submit to.
   *
   * An unknown code is a warning, never a blocker: the project is still
   * submitted (as unassigned) and an organizer can file it later, which is far
   * better than losing a finished project because of a typo in a code.
   */
  const resolveCode = async (raw: string): Promise<Hackathon | null> => {
    const code = raw.trim();
    if (!code) {
      setHackathon(null);
      setCodeError(null);
      return null;
    }
    if (code.length < 3) {
      setHackathon(null);
      setCodeError("Enter the full hackathon code, or leave it empty.");
      return null;
    }
    setJoining(true);
    try {
      const found = await findHackathonByCode(code, user?.id ?? null);
      setHackathon(found);
      setCodeError(
        found
          ? null
          : "No hackathon found for this code. You can remove the code and submit without a hackathon, or check the code.",
      );
      return found;
    } catch (error) {
      setHackathon(null);
      setCodeError(
        error instanceof Error
          ? error.message
          : "Could not check that code. You can still submit without one.",
      );
      return null;
    } finally {
      setJoining(false);
    }
  };

  /**
   * Read the uploaded deck and extract the team's claims.
   *
   * Runs entirely in the browser and never rejects: an unreadable document
   * lands in the `failed` state with a reason, and the submission keeps
   * working — the file is still attached for the judges.
   */
  useEffect(() => {
    if (!deckFile) {
      docAnalysisRef.current = null;
      setDocAnalysis(null);
      setDocPhase("idle");
      return;
    }
    let cancelled = false;
    docAnalysisRef.current = null;
    setDocAnalysis(null);
    setDocPhase("extracting");
    const analysis = analyzeDocumentFile(deckFile)
      .then((result) => {
        docAnalysisRef.current = result.extraction.status === "failed" ? null : result;
        if (cancelled) return;
        setDocAnalysis(result);
        setDocPhase(result.extraction.status === "failed" ? "failed" : "done");
      })
      .catch((error: unknown) => {
        // analyzeDocumentFile is designed not to throw; this is a safety net.
        console.error("Document analysis failed", error);
        if (cancelled) return;
        setDocAnalysis(null);
        setDocPhase("failed");
      });
    docPromiseRef.current = analysis;
    return () => {
      cancelled = true;
    };
  }, [deckFile]);

  /** Persisted into report_data.document_analysis for the report + AI judge. */
  const documentAnalysisPayload = useMemo(
    () =>
      documentAnalysisPayloadOf(
        docAnalysis ??
          (deckFile && docPhase === "failed"
            ? {
                extraction: {
                  fileName: deckFile.name,
                  fileSizeBytes: deckFile.size,
                  kind: "unsupported",
                  totalPages: 0,
                  pages: [],
                  fullText: "",
                  method: "none",
                  status: "failed",
                  ocrAttempted: false,
                  ocrApplied: false,
                  error: "Document analysis could not complete.",
                  warnings: [],
                  extractedAt: new Date().toISOString(),
                },
                claims: null,
              }
            : null),
      ),
    [docAnalysis, deckFile, docPhase],
  );

  const reportData: Json = {
    repo_url: repo.trim() || null,
    website_url: live.trim() || null,
    description: notes.trim() || null,
    attachments,
    // JSON-safe payload (snake_case, flat) — same boundary cast the analysis
    // service uses when writing report_data.
    document_analysis: documentAnalysisPayload as Json | null,
  };

  /**
   * Kick off the analysis pipeline for a freshly created report.
   *
   * The run is not awaited: `/progress` subscribes to its stages while the report
   * row carries the durable status. Guest and authenticated runs use different
   * persistence adapters, so guest data never reaches Supabase.
   */
  const startAnalysis = ({
    isGuestSubmission,
    hackathonSubmissionId,
    candidateId,
    ...submission
  }: {
    projectId: string;
    reportId: string;
    name: string;
    repoUrl: string | null;
    websiteUrl: string | null;
    notes: string | null;
    createdAt: string;
    isGuestSubmission: boolean;
    document: DocumentAnalysis | null;
    /** Set when the project was submitted to a hackathon. */
    hackathonSubmissionId?: string | null;
    candidateId?: string | null;
  }) => {
    const input: AnalysisInput = { ...submission, attachments };
    const run = startProjectAnalysis(
      input,
      analysisPersistenceFor(submission.reportId, isGuestSubmission),
    );
    // The record already exists, so a failed final write only needs surfacing.
    run?.catch((error: unknown) => {
      console.error(error);
      notify.error(
        "Analysis result could not be saved",
        "The project and report were kept — open the report to retry.",
      );
    });
    // The candidate's status page follows the same analysis: in progress now,
    // complete when the run settles. Bookkeeping only — never blocks the run.
    if (run && hackathonSubmissionId && candidateId) {
      void run
        .then(() =>
          syncSubmissionProgress(hackathonSubmissionId, candidateId, { status: "analyzed" }),
        )
        .catch(() => undefined);
    }
  };

  /**
   * Hand off to the analysis page with real ids, after a short success beat.
   * The analysis itself runs there, so this button never claims the evaluation
   * has finished when only the submission has.
   */
  const finishSubmission = (
    projectId: string,
    reportId: string,
    projectName: string,
    hackathonSubmissionId: string | null,
  ) => {
    setSubmitState("success");
    notify.success("Project submitted", `${projectName} is queued for investigation.`);
    window.setTimeout(() => {
      // The candidate sees a short confirmation — the judge-side analysis stays in
      // the portal. Without a submission row there is no portal record to open.
      if (hackathonSubmissionId) {
        navigate({ to: "/submission/$id", params: { id: hackathonSubmissionId } });
      } else {
        navigate({ to: "/progress", search: { projectId, reportId } });
      }
    }, 400);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched({ name: true, repo: true, live: true });
    if (!canSubmit || authLoading || busy) {
      notify.error("Check your inputs", "Complete the highlighted fields before analyzing.");
      return;
    }

    // A retry before the error state resets must not be overwritten by the old timer.
    if (errorResetTimer.current !== null) {
      window.clearTimeout(errorResetTimer.current);
      errorResetTimer.current = null;
    }

    setSubmitState("submitting");
    // Indeterminate stages appear only if the request is genuinely slow.
    const stageTimer = window.setTimeout(() => setSubmitState("processing"), 1200);

    // Give an in-flight document read a bounded chance to finish so its
    // claims land in the report; extraction must never block submission.
    if (docPhase === "extracting" && docPromiseRef.current) {
      await Promise.race([
        docPromiseRef.current,
        new Promise((resolve) => window.setTimeout(resolve, 15_000)),
      ]);
    }

    try {
      // Resolve the hackathon if a code was typed. An unknown code never blocks
      // the submission: the project is filed unassigned and the judges can attach
      // it to an event once the team confirms which one it was.
      let target: Hackathon | null = null;
      if (joinCode.trim()) {
        target =
          hackathon && hackathon.code.toUpperCase() === joinCode.trim().toUpperCase()
            ? hackathon
            : await resolveCode(joinCode);
        if (!target) {
          setCodeTouched(true);
          notify.info(
            "Submitting as an unassigned project",
            "No hackathon matched that code, so the judges can file it for you later.",
          );
        }
      }

      // Guest submissions never reach Supabase (no session ⇒ no user id); they are
      // stored in this browser and rendered by the same pages as real rows.
      if (isGuest || !user) {
        const project = createGuestProject({
          name: name.trim(),
          repo_url: repo.trim() || null,
          website_url: live.trim() || null,
          description: notes.trim() || null,
        });
        const report = createGuestReport({
          type: "Project",
          name: project.name,
          project_id: project.id,
          status: "In Progress",
          report_data: reportData,
        });

        const candidateId = portalCandidateId(null, true);
        // Always recorded: an unassigned project is still a submission, and this
        // is the row the candidate's status page and the judges' intake read.
        const hackathonSubmission = await submitToHackathon({
          hackathonId: target?.id ?? null,
          candidateId,
          teamName: teamName.trim() || project.name,
          teamMembers,
          description: project.description,
          repoUrl: project.repo_url,
          websiteUrl: project.website_url,
          deckName: deckFile?.name ?? null,
          projectId: project.id,
          reportId: report.id,
        });
        await syncSubmissionProgress(hackathonSubmission.id, candidateId, {
          status: "processing",
        });

        // The guest report stays in this browser; the pipeline updates it through
        // the guest adapter and never touches Supabase.
        startAnalysis({
          projectId: project.id,
          reportId: report.id,
          name: project.name,
          repoUrl: project.repo_url,
          websiteUrl: project.website_url,
          notes: project.description,
          createdAt: report.created_at,
          isGuestSubmission: true,
          document: docAnalysisRef.current,
          hackathonSubmissionId: hackathonSubmission.id,
          candidateId,
        });

        window.clearTimeout(stageTimer);
        finishSubmission(project.id, report.id, project.name, hackathonSubmission.id);
        return;
      }

      const project = await createProjectForUser(user.id, {
        name: name.trim(),
        repo_url: repo.trim() || null,
        website_url: live.trim() || null,
        description: notes.trim() || null,
        status: "draft",
      });

      // The investigation produces a report for this project; create it through the
      // report service so /progress can carry its real id on to /report/$id.
      const report = await createReportForUser(user.id, {
        type: "Project",
        name: project.name,
        project_id: project.id,
        status: "In Progress",
        report_data: reportData,
      });

      // The submission is the judge portal's record. It is idempotent per
      // (hackathon, candidate), so a retried submit updates one row.
      const candidateId = portalCandidateId(user.id, false);
      const hackathonSubmission = await submitToHackathon({
        hackathonId: target?.id ?? null,
        candidateId,
        teamName: teamName.trim() || project.name,
        teamMembers,
        description: project.description,
        repoUrl: project.repo_url,
        websiteUrl: project.website_url,
        deckName: deckFile?.name ?? null,
        projectId: project.id,
        reportId: report.id,
      });
      await syncSubmissionProgress(hackathonSubmission.id, candidateId, { status: "processing" });

      startAnalysis({
        projectId: project.id,
        reportId: report.id,
        name: project.name,
        repoUrl: project.repo_url,
        websiteUrl: project.website_url,
        notes: project.description,
        createdAt: report.created_at,
        isGuestSubmission: false,
        document: docAnalysisRef.current,
        hackathonSubmissionId: hackathonSubmission.id,
        candidateId,
      });

      window.clearTimeout(stageTimer);
      finishSubmission(project.id, report.id, project.name, hackathonSubmission.id);
    } catch (error) {
      window.clearTimeout(stageTimer);
      console.error(error);
      setSubmitState("error");
      notify.error("Submission failed", "We couldn't create this project review.");
      // Return to the idle label so the action stays available for a retry.
      errorResetTimer.current = window.setTimeout(() => {
        setSubmitState("idle");
        errorResetTimer.current = null;
      }, 3200);
    }
  };

  const field = (
    id: string,
    value: string,
    onChange: (v: string) => void,
    isValid: boolean,
    hasError: boolean,
    label: string,
    placeholder: string,
    Icon?: typeof Globe,
  ) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        {Icon && (
          <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        )}
        <Input
          id={id}
          type="url"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, [id]: true }))}
          aria-invalid={hasError}
          aria-describedby={hasError ? `${id}-err` : undefined}
          className={`${Icon ? "pl-9" : ""} ${hasError ? "border-destructive focus-visible:ring-destructive" : isValid && value ? "border-success/50" : ""}`}
        />
      </div>
      {hasError && <FieldError id={`${id}-err`}>Enter a valid URL (https://…)</FieldError>}
    </div>
  );

  return (
    <AppLayout
      title="Review Project"
      subtitle="Tell us where to look. We'll gather the evidence."
      crumbs={[{ label: "Review Project" }]}
    >
      <motion.form
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE_OUT }}
        className="surface mx-auto max-w-3xl space-y-7 p-6 sm:p-8"
        onSubmit={submit}
        noValidate
      >
        {isGuest ? (
          <p className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm text-foreground">
            <UserRound className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            Submitting without an account — your project and report are saved to this browser.
          </p>
        ) : (
          !user && (
            <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
              Sign in to submit a project review.
            </div>
          )
        )}
        <div className="space-y-7">
          {/* Hackathon — optional. A code files the project under that event; an
              empty field files it as unassigned for the judge portal to place. */}
          <div className="space-y-2">
            <Label htmlFor="hackathonCode">
              Hackathon code <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <div className="relative">
              <Ticket
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="hackathonCode"
                value={joinCode}
                placeholder="Enter a hackathon code if you have one"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setJoinCode(event.target.value.toUpperCase());
                  setHackathon(null);
                  setCodeError(null);
                }}
                onBlur={() => {
                  setCodeTouched(true);
                  void resolveCode(joinCode);
                }}
                aria-describedby="hackathonCode-help"
                className={`pl-9 pr-9 ${codeTouched && codeError ? "border-warning/60 focus-visible:ring-warning/40" : hackathon ? "border-success/50" : ""}`}
              />
              {joining ? (
                <Loader2
                  className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
                  aria-hidden
                />
              ) : hackathon ? (
                <CheckCircle2
                  className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-success"
                  aria-hidden
                />
              ) : null}
            </div>
            {codeTouched && codeError ? (
              <p id="hackathonCode-err" className="flex items-start gap-1.5 text-xs text-warning">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {codeError}
              </p>
            ) : hackathon ? (
              <p className="text-xs text-success">
                Linked to {hackathon.name} · <span className="font-mono">{hackathon.code}</span>
              </p>
            ) : (
              <p id="hackathonCode-help" className="text-xs text-muted-foreground">
                Optional. With a code the project goes straight into that hackathon&apos;s judge
                queue; without one it is submitted as <strong>unassigned</strong> and an organiser
                can add it to a hackathon later. Either way your submission is saved.
              </p>
            )}
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="pname">
              Project Name{" "}
              <span className="text-destructive" aria-hidden>
                *
              </span>
            </Label>
            <Input
              id="pname"
              value={name}
              placeholder="e.g. Aurora — Realtime Analytics"
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, name: true }))}
              aria-invalid={showNameError}
              aria-describedby={showNameError ? "pname-err" : undefined}
              className={showNameError ? "border-destructive focus-visible:ring-destructive" : ""}
            />
            {showNameError && (
              <FieldError id="pname-err">Please give the project a name.</FieldError>
            )}
          </div>

          {/* Team name */}
          <div className="space-y-2">
            <Label htmlFor="pteamname">
              Team name <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="pteamname"
              value={teamName}
              placeholder="Team Alpha"
              onChange={(event) => setTeamName(event.target.value)}
              aria-describedby="pteamname-help"
            />
            <p id="pteamname-help" className="text-xs text-muted-foreground">
              Shown to the judges next to your project. Defaults to the project name.
            </p>
          </div>

          {/* Team members */}
          <div className="space-y-2">
            <Label htmlFor="pteam">
              Team members <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="pteam"
              value={members}
              placeholder="Ada Lovelace, Grace Hopper"
              onChange={(event) => setMembers(event.target.value)}
              aria-describedby="pteam-help"
            />
            <p id="pteam-help" className="text-xs text-muted-foreground">
              Comma separated. Shown to the judges alongside the project.
            </p>
          </div>

          {/* URLs */}
          <div className="grid gap-6 sm:grid-cols-2">
            {field(
              "repo",
              repo,
              setRepo,
              repoValid,
              showRepoError,
              "GitHub Repository URL",
              "https://github.com/org/repo",
            )}
            {field(
              "live",
              live,
              setLive,
              liveValid,
              showLiveError,
              "Live Website URL",
              "https://example.com",
              Globe,
            )}
          </div>

          {/* Uploads */}
          <div className="grid gap-6 sm:grid-cols-2">
            <FileDrop
              id="deck"
              label="Presentation Upload"
              accept=".pdf,.pptx,.ppt,.key,.png,.jpg,.jpeg"
              types={["pdf", "pptx", "ppt", "key", "png", "jpg", "jpeg"]}
              hint="PDF, PPTX or slide image · max 25 MB"
              required
              onFile={setDeckFile}
              onStatusChange={setDeckStatus}
            />
            <FileDrop
              id="video"
              label="Demo Video Upload (Optional)"
              accept="video/*"
              types={["mp4", "mov", "webm"]}
              hint="MP4 or MOV · max 25 MB"
              maxSizeMb={25}
              onStatusChange={setVideoStatus}
            />
          </div>

          {/* Document Analysis — extraction states + unverified claims */}
          <DocumentAnalysisPanel phase={docPhase} analysis={docAnalysis} />

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Additional Notes</Label>
            <Textarea
              id="notes"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything reviewers should focus on…"
              maxLength={500}
              aria-describedby="notes-count"
            />
            <p id="notes-count" className="text-right text-xs text-muted-foreground">
              {notes.length}/500
            </p>
          </div>

          {/* Requirements checklist */}
          <ul
            className="rounded-lg bg-muted/40 px-4 py-3 text-sm"
            aria-label="Submission requirements"
          >
            {needs.map((n) => (
              <li key={n.key} className="flex items-center gap-2 py-1 last:pb-0">
                <motion.span
                  key={String(n.met)}
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 420, damping: 26 }}
                  className="grid place-items-center"
                  aria-hidden
                >
                  {n.met ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                </motion.span>
                <span className={n.met ? "text-success" : "text-muted-foreground"}>{n.text}</span>
              </li>
            ))}
          </ul>

          <div className="space-y-2">
            <MovingBorder className="w-full" radius="0.625rem">
              <SubmitButton
                type="submit"
                size="lg"
                state={submitState}
                idleLabel="Analyze Project"
                successLabel="Evaluation started"
                className="h-12 w-full text-base"
                disabled={!canSubmit}
                aria-disabled={!canSubmit}
              />
            </MovingBorder>
            <p className="text-center text-xs text-muted-foreground">
              Every finding is tied to evidence. Nothing is invented.
            </p>
          </div>
        </div>
      </motion.form>
    </AppLayout>
  );
}
