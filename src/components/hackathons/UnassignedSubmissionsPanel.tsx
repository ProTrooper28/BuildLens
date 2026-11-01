import { useState } from "react";
import { ArrowRight, Inbox } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useAssignSubmission,
  useJudgeHackathons,
  useUnassignedSubmissions,
} from "@/hooks/useHackathonPortal";
import type { UnassignedSubmissionRow } from "@/services/portal.service";
import type { HackathonSummary } from "@/types/hackathon";
import { notify } from "@/lib/toast-messages";

/**
 * The intake pool: projects a candidate submitted without a hackathon code.
 *
 * The submission is real — deck, repo, deployment URL and analysis are all
 * stored; only its `hackathon_id` is empty. Filing it here is a single update of
 * that column, so nothing is copied and the candidate's own status page starts
 * showing the event as soon as the judge assigns one.
 */
export function UnassignedSubmissionsPanel() {
  const rowsQuery = useUnassignedSubmissions();
  const rows = rowsQuery.data ?? [];

  if (rowsQuery.isLoading) {
    return (
      <section aria-label="Unassigned submissions" className="mb-12">
        <h2 className="mb-3 text-lg font-semibold">Unassigned submissions</h2>
        <div className="h-16 animate-pulse rounded-xl border border-border/70 bg-card/40" />
      </section>
    );
  }

  if (rowsQuery.isError) {
    return (
      <section aria-label="Unassigned submissions" className="mb-12">
        <h2 className="mb-3 text-lg font-semibold">Unassigned submissions</h2>
        <div className="rounded-xl border border-destructive/30 bg-destructive/[0.06] px-4 py-3 text-sm text-destructive">
          Projects waiting for a hackathon could not be loaded.
        </div>
      </section>
    );
  }

  // Nothing waiting: the panel stays out of the way rather than showing an
  // empty box above every hackathon list.
  if (rows.length === 0) return null;

  return (
    <section aria-label="Unassigned submissions" className="mb-12">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Inbox className="h-4 w-4 text-muted-foreground" aria-hidden />
          Unassigned submissions
        </h2>
        <p className="text-sm text-muted-foreground">
          Sent without a hackathon code. File one under an event and it joins that hackathon&apos;s
          judging queue immediately.
        </p>
      </div>
      <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card/50">
        {rows.map((row) => (
          <UnassignedRow key={row.submission.id} row={row} />
        ))}
      </ul>
    </section>
  );
}

function UnassignedRow({ row }: { row: UnassignedSubmissionRow }) {
  const [target, setTarget] = useState("");
  const assign = useAssignSubmission();
  const busy = assign.isPending;
  const projectName = row.projectName ?? row.submission.teamName;

  const file = () => {
    if (!target) return;
    assign.mutate(
      { submissionId: row.submission.id, hackathonId: target },
      {
        onSuccess: () => {
          notify.success("Submission assigned", `${projectName} now belongs to that hackathon.`);
        },
        onError: (cause) => {
          notify.error(
            "Couldn't assign the submission",
            cause instanceof Error ? cause.message : "Try again.",
          );
        },
      },
    );
  };

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{projectName}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>Team {row.submission.teamName}</span>
          <span className="text-border">·</span>
          <span>Status: Awaiting hackathon assignment</span>
        </p>
      </div>
      <HackathonPicker value={target} onValueChange={setTarget} disabled={busy} />
      <Button size="sm" disabled={!target || busy} onClick={file}>
        {busy ? "Assigning…" : "Assign to Hackathon"} <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}

/**
 * The events this judge can file a submission into.
 *
 * The list comes from the same query the hackathon section uses, so it can
 * never offer an event the viewer does not judge — the service refuses the
 * write as well, but the picker does not tempt anyone with it.
 */
function HackathonPicker({
  value,
  onValueChange,
  disabled,
}: {
  value: string;
  onValueChange: (next: string) => void;
  disabled: boolean;
}) {
  const hackathons = useJudgeHackathons();
  const options: HackathonSummary[] = hackathons.data ?? [];

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled || options.length === 0}>
      <SelectTrigger className="w-56" aria-label="Choose a hackathon">
        <SelectValue
          placeholder={options.length === 0 ? "No hackathons yet" : "Choose a hackathon"}
        />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.name} · {option.code}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
