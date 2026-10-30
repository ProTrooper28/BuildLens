import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  clearStoredRunId,
  fetchEvidenceRun,
  isRunInFlight,
  readStoredRunId,
  startEvidenceRun,
  storeRunId,
} from "@/services/judging/evidence.service";
import type { EvaluationRun } from "@/services/evaluation-agent/schema";
import type { EvidenceBundle } from "@/services/evidence/types";
import type { SubmissionDetail } from "@/types/evaluation";

/**
 * Evidence run for one submission.
 *
 * Refresh-safe by design: the run id is remembered per submission, the run
 * itself is persisted by the agent's store, and a fresh page load re-reads that
 * run instead of starting (and paying for) another one. Only an explicit
 * "Run again" starts a new run.
 *
 * The evidence bundle is persisted before the model call, so a run whose AI
 * stage failed still has a complete inspection. That run is `partial`, not an
 * error: the judge gets the full findings and a note that the narrative is
 * missing.
 */

export type EvidencePhase = "idle" | "starting" | "running" | "ready" | "error";

export interface EvidenceRunState {
  runId: string | null;
  run: EvaluationRun | null;
  /** Persisted evidence bundle — present even when the AI stage failed. */
  bundle: EvidenceBundle | null;
  /** True when the bundle exists but the run itself did not complete. */
  partial: boolean;
  phase: EvidencePhase;
  error: string | null;
  start: () => void;
  retry: () => void;
  starting: boolean;
}

export function useEvidenceRun(
  detail: SubmissionDetail | null,
  options: { autoStart?: boolean } = {},
): EvidenceRunState {
  const queryClient = useQueryClient();
  const submissionId = detail?.id ?? null;
  const [runId, setRunId] = useState<string | null>(null);
  const autoStarted = useRef<string | null>(null);

  // Restore the run this browser already started for the submission.
  useEffect(() => {
    setRunId(submissionId ? readStoredRunId(submissionId) : null);
  }, [submissionId]);

  const runQuery = useQuery({
    queryKey: ["evidence", "run", runId],
    queryFn: () => fetchEvidenceRun(runId as string),
    enabled: Boolean(runId),
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
    refetchInterval: (query) => (isRunInFlight(query.state.data ?? null) ? 2500 : false),
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!detail) throw new Error("No submission is open.");
      return startEvidenceRun(detail);
    },
    onSuccess: (run) => {
      if (submissionId) storeRunId(submissionId, run.id);
      setRunId(run.id);
      queryClient.setQueryData(["evidence", "run", run.id], run);
    },
  });

  const start = useCallback(() => {
    if (startMutation.isPending) return;
    startMutation.mutate();
  }, [startMutation]);

  const retry = useCallback(() => {
    // A stored run that the server no longer knows about must be forgotten,
    // otherwise every reload would repeat the same 404.
    if (submissionId) clearStoredRunId(submissionId);
    setRunId(null);
    startMutation.reset();
    startMutation.mutate();
  }, [startMutation, submissionId]);

  // Automatic inspection: a submission opened for the first time is inspected
  // without the judge having to ask. A stored run is resumed instead, never
  // re-started, so opening the same submission twice does not pay twice.
  useEffect(() => {
    if (!options.autoStart || !detail || !submissionId) return;
    if (autoStarted.current === submissionId) return;
    if (readStoredRunId(submissionId)) return;
    if (startMutation.isPending) return;
    autoStarted.current = submissionId;
    startMutation.mutate();
    // `startMutation` is stable for the lifetime of this hook instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.autoStart, detail, submissionId]);

  const run = runQuery.data ?? null;
  const bundle: EvidenceBundle | null = run?.evidenceBundle ?? run?.result?.evidenceBundle ?? null;
  const failure =
    startMutation.error instanceof Error
      ? startMutation.error.message
      : runQuery.error instanceof Error
        ? runQuery.error.message
        : run?.status === "failed"
          ? (run.error ?? "The evidence run failed.")
          : null;
  const partial = Boolean(bundle) && Boolean(failure);

  let phase: EvidencePhase = "idle";
  if (startMutation.isPending) phase = "starting";
  else if (failure) phase = bundle ? "ready" : "error";
  else if (run?.status === "completed") phase = "ready";
  else if (run && isRunInFlight(run)) phase = "running";
  else if (runQuery.isLoading && runId) phase = "running";
  else if (run) phase = isRunInFlight(run) ? "running" : "error";

  return {
    runId,
    run,
    bundle,
    partial,
    phase,
    error: failure,
    start,
    retry,
    starting: startMutation.isPending,
  };
}
