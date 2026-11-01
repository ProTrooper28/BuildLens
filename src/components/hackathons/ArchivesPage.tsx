import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Archive, KeyRound, Lock, ShieldCheck } from "lucide-react";

import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { GlassFolder, type FolderFile } from "@/components/ui/glass-folder-cards";
import { RealHackathonsPanel } from "./RealHackathonsPanel";
import { UnassignedSubmissionsPanel } from "./UnassignedSubmissionsPanel";
import { notify } from "@/lib/toast-messages";
import { cn } from "@/lib/utils";
import {
  HACKATHONS,
  hackathonArchive,
  isKnownHackathonCode,
  normaliseHackathonCode,
} from "@/lib/hackathons/data";
import { hackathonCriteriaSet, hackathonStats } from "@/lib/hackathons/store";
import type { HackathonArchive } from "@/types/hackathon";

/**
 * The judge's archives: one folder per hackathon.
 *
 * Opening a folder opens that hackathon's isolated workspace — the code on the
 * folder is the scope every project, resume, score and ranking inside it is
 * filtered by, so HACK-001 never shows a row from HACK-002.
 *
 * The folders are measured, not hard-coded: the grid gives each one the width
 * its column actually has, so the same card reads correctly at 260px on a phone
 * and 360px on a desktop.
 */

function useFolderWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  // Start at the smallest size, so the first frame can never overflow its
  // column; the measurement below grows it to the width it actually has.
  const [width, setWidth] = useState(248);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const measured = el.clientWidth;
    if (measured > 0) setWidth(Math.round(Math.min(380, Math.max(248, measured))));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();

    // Follow the column as the window changes (and as the grid reflows).
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  return { ref, width };
}

function FolderCell({
  archive,
  onOpen,
  onCopyCode,
}: {
  archive: HackathonArchive;
  onOpen: (code: string) => void;
  onCopyCode: (code: string) => void;
}) {
  const { ref, width } = useFolderWidth<HTMLDivElement>();
  const stats = hackathonStats(archive.code);
  const set = hackathonCriteriaSet(archive.code);
  const [opening, setOpening] = useState(false);
  const timer = useRef<number | null>(null);

  // The glass hinge and the files are CSS transitions, so the route swap waits
  // for them to be seen: the folder falls open, then the workspace rises in
  // behind it. Reduced motion skips the wait entirely.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const openWithAnimation = () => {
    if (opening) return;
    setOpening(true);
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    timer.current = window.setTimeout(() => onOpen(archive.code), reduced ? 0 : 280);
  };

  const files: FolderFile[] = [
    { name: "Projects", meta: `${stats.projects} items` },
    { name: "Resumes", meta: `${stats.resumes} items` },
    { name: "Rankings", meta: archive.judgingState === "open" ? "Not started" : "Ready" },
    {
      name: "Scores",
      meta:
        stats.scoredByMe > 0 ? `${stats.scoredByMe} scored by you` : `${set.maxScore} pt rubric`,
    },
  ];

  return (
    <div
      ref={ref}
      className={cn("w-full transition-opacity duration-300", opening && "opacity-70")}
      aria-busy={opening || undefined}
    >
      <GlassFolder
        label={archive.name}
        meta={`${archive.projectCount} projects · ${archive.resumeCount} resumes`}
        tone={archive.tone}
        art={archive.art}
        seed={archive.seed}
        files={files}
        width={width}
        appear
        className="hackathon-folder"
        labelPlacement={archive.tone === "dark" ? "top-right" : "bottom-left"}
        action="more"
        menu={[
          { label: `Open ${archive.code}`, onSelect: openWithAnimation },
          { label: "Copy hackathon code", onSelect: () => onCopyCode(archive.code) },
        ]}
        onOpenChange={(open) => {
          if (open) openWithAnimation();
        }}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2 pl-1">
        <span className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground">
          {archive.code}
        </span>
        <span className="text-border">·</span>
        <span className="text-[11px] text-muted-foreground">{archive.dates}</span>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-medium",
            archive.judgingState === "complete"
              ? "border-success/30 bg-success/10 text-success"
              : archive.judgingState === "scoring"
                ? "border-warning/30 bg-warning/10 text-warning"
                : "border-border/70 bg-muted/40 text-muted-foreground",
          )}
        >
          {archive.judgingState === "complete"
            ? "Judging complete"
            : archive.judgingState === "scoring"
              ? "Judging in progress"
              : "Open for judging"}
        </span>
      </div>
      <p className="mt-1 max-w-[38ch] pl-1 text-[11px] leading-relaxed text-muted-foreground">
        {archive.subtitle} · {archive.location}
      </p>
    </div>
  );
}

export function ArchivesPage() {
  const navigate = useNavigate();
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const openArchive = useCallback(
    (archiveCode: string) => {
      // The folder's own opening animation plays first, then the route swaps;
      // the workspace animates in from behind it (see HackathonWorkspace).
      void navigate({
        to: "/hackathons/$code",
        params: { code: archiveCode },
        search: { view: "overview" },
      });
    },
    [navigate],
  );

  const copyCode = useCallback((archiveCode: string) => {
    void navigator.clipboard?.writeText(archiveCode).then(
      () => notify.copied("hackathon code"),
      () => notify.info("Hackathon code", archiveCode),
    );
  }, []);

  const join = () => {
    const normalised = normaliseHackathonCode(code);
    if (!normalised) {
      setError("Codes look like HACK-001 — letters, numbers and dashes.");
      return;
    }
    if (!isKnownHackathonCode(normalised)) {
      setError(`No archive is open under ${normalised}. Check the code with your organiser.`);
      return;
    }
    const archive = hackathonArchive(normalised);
    setJoining(false);
    setCode("");
    setError(null);
    if (archive) openArchive(archive.code);
  };

  return (
    <AppLayout
      title="Hackathon archives"
      subtitle="One folder per hackathon. Every project, resume, score and ranking stays inside the archive it belongs to."
      crumbs={[{ label: "Archives" }]}
      actions={
        <Dialog open={joining} onOpenChange={setJoining}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <KeyRound className="h-4 w-4" /> Join hackathon
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Join a hackathon</DialogTitle>
              <DialogDescription>
                Enter the code from your organiser to open that archive.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Input
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  setError(null);
                }}
                placeholder="HACK-001"
                aria-label="Hackathon code"
                className="font-mono uppercase tracking-[0.14em]"
                onKeyDown={(event) => {
                  if (event.key === "Enter") join();
                }}
              />
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              <Button className="w-full" onClick={join} disabled={!code.trim()}>
                <Archive className="h-4 w-4" />
                Open archive
              </Button>
            </div>
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              The code decides which workspace you enter. Scores you file there never appear in any
              other archive.
            </p>
          </DialogContent>
        </Dialog>
      }
    >
      {/* Real events first: these are the ones a candidate can join. */}
      <RealHackathonsPanel />

      {/* Projects submitted without a code, waiting for an event. */}
      <UnassignedSubmissionsPanel />

      <div className="grid items-start gap-x-10 gap-y-14 sm:grid-cols-2 xl:grid-cols-3">
        {HACKATHONS.map((archive) => (
          <FolderCell
            key={archive.code}
            archive={archive}
            onOpen={openArchive}
            onCopyCode={copyCode}
          />
        ))}
      </div>

      <div className="mt-14 rounded-xl border border-dashed border-border/70 bg-card/40 px-5 py-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          Nothing is mixed between archives
        </p>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          Projects, resumes, criteria, drafts and scores are stored against the hackathon code that
          owns them. Opening HACK-002 reads only HACK-002 rows — a score filed elsewhere is not
          merged in, averaged in, or shown.
        </p>
      </div>
    </AppLayout>
  );
}
