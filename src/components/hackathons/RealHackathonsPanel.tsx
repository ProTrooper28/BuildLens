import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Copy, Gavel, Plus, Ticket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { portalKeys, useJudgeHackathons } from "@/hooks/useHackathonPortal";
import { createHackathon, portalJudgeId, portalStorageNotice } from "@/services/hackathon.service";
import { notify } from "@/lib/toast-messages";

/**
 * The hackathons this organizer actually runs.
 *
 * Creating one here is what makes it reachable from the candidate portal: the
 * code it returns is the code a candidate types on the submission form, and the
 * submissions they send appear in this event's judge queue. The sample folders
 * below stay a separate, clearly-labelled demo cohort.
 */
/** A date input value (`2026-11-14`) as the ISO timestamp the table stores. */
function toIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function RealHackathonsPanel() {
  const { user, profile } = useAuth();
  const viewerId = portalJudgeId(user?.id ?? null);
  const queryClient = useQueryClient();
  const hackathons = useJudgeHackathons();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = hackathons.data ?? [];
  const notice = portalStorageNotice();

  const copyCode = (value: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => notify.copied("hackathon code"),
      () => notify.info("Hackathon code", value),
    );
  };

  const create = async () => {
    if (name.trim().length < 2) {
      setError("Give the hackathon a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createHackathon(
        { id: viewerId, name: profile?.full_name ?? null },
        {
          name: name.trim(),
          code: code.trim() || undefined,
          description: description.trim() || null,
          startsAt: toIso(startsAt),
          endsAt: toIso(endsAt),
        },
      );
      await queryClient.invalidateQueries({ queryKey: portalKeys.judgeHackathons(viewerId) });
      setOpen(false);
      setName("");
      setCode("");
      setDescription("");
      setStartsAt("");
      setEndsAt("");
      notify.success("Hackathon created", `Candidates join with ${created.code}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The hackathon could not be created.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Your hackathons" className="mb-12">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Your hackathons</h2>
          <p className="text-sm text-muted-foreground">
            Real events and their join codes. Submissions sent with a code appear in that event's
            judge queue.
          </p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setError(null);
          }}
        >
          <DialogTrigger asChild>
            <Button variant="hero" size="sm">
              <Plus className="h-4 w-4" /> Create hackathon
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create a hackathon</DialogTitle>
              <DialogDescription>
                The code is what candidates type to submit. Leave it empty to have one generated.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="hackathon-name">Name</Label>
                <Input
                  id="hackathon-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Climate Hack 2026"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hackathon-code">Join code (optional)</Label>
                <Input
                  id="hackathon-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder="CLIMATE-2026"
                  className="font-mono uppercase tracking-[0.12em]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="hackathon-start">Starts</Label>
                  <Input
                    id="hackathon-start"
                    type="date"
                    value={startsAt}
                    onChange={(event) => setStartsAt(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hackathon-end">Ends</Label>
                  <Input
                    id="hackathon-end"
                    type="date"
                    value={endsAt}
                    onChange={(event) => setEndsAt(event.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hackathon-description">Description</Label>
                <Textarea
                  id="hackathon-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  placeholder="What teams build, and how it is judged…"
                />
              </div>
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              <Button className="w-full" onClick={() => void create()} disabled={saving}>
                {saving ? "Creating…" : "Create hackathon"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {hackathons.isLoading ? (
        <div className="h-20 animate-pulse rounded-xl border border-border/70 bg-card/40" />
      ) : hackathons.isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/[0.06] px-4 py-3 text-sm text-destructive">
          Your hackathons could not be loaded.{" "}
          {hackathons.error instanceof Error ? hackathons.error.message : null}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-card/40 px-5 py-6">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Ticket className="h-4 w-4 text-muted-foreground" aria-hidden />
            No hackathons yet
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Create one to get a join code. Anything a candidate submits with that code lands in your
            judge queue — no copying, no second project record.
          </p>
        </div>
      ) : (
        <>
          {notice ? (
            <p className="mb-3 rounded-lg border border-warning/30 bg-warning/[0.07] px-4 py-2.5 text-xs text-warning">
              {notice.text}
            </p>
          ) : null}
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card/50">
            {rows.map((hackathon) => (
              <li
                key={hackathon.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{hackathon.name}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono tracking-[0.12em]">{hackathon.code}</span>
                    <button
                      type="button"
                      onClick={() => copyCode(hackathon.code)}
                      className="inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-accent hover:text-foreground"
                      aria-label={`Copy join code ${hackathon.code}`}
                    >
                      <Copy className="h-3 w-3" aria-hidden />
                    </button>
                    <span className="text-border">·</span>
                    <span>
                      {hackathon.submissionCount} submission
                      {hackathon.submissionCount === 1 ? "" : "s"} · {hackathon.scoredCount} scored
                    </span>
                    <span className="text-border">·</span>
                    <span>
                      {hackathon.criteria.length} criteria · {hackathon.maxScore} pts
                    </span>
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 capitalize">
                  {hackathon.status}
                </Badge>
                <Button asChild variant="outline" size="sm">
                  <Link to="/evaluation/project">
                    <Gavel className="h-3.5 w-3.5" /> Judge
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
