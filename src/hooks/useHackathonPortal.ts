import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import {
  listCandidateSubmissions,
  listJudgeHackathons,
  portalCandidateId,
  portalJudgeId,
} from "@/services/hackathon.service";
import {
  fetchCandidateStatus,
  fetchHackathonWorkspace,
  fetchJudgeProject,
} from "@/services/portal.service";

/**
 * Shared hackathon portal queries.
 *
 * The same records back both portals, so both hooks read the same service and
 * differ only in which side of the relationship they ask for: candidates list the
 * submissions they sent, judges list the hackathons they own or are assigned to.
 */

const STALE_TIME = 30_000;

export const portalKeys = {
  candidateSubmissions: (candidateId: string) =>
    ["hackathon", "candidate-submissions", candidateId] as const,
  judgeHackathons: (viewerId: string) => ["hackathon", "judge-hackathons", viewerId] as const,
  workspace: (code: string, viewerId: string) =>
    ["hackathon", "workspace", code.toUpperCase(), viewerId] as const,
  project: (code: string, submissionId: string, viewerId: string) =>
    ["hackathon", "project", code.toUpperCase(), submissionId, viewerId] as const,
  candidateStatus: (submissionId: string, candidateId: string) =>
    ["hackathon", "candidate-status", submissionId, candidateId] as const,
};

/** The logged-in candidate's own submissions (and their hackathons). */
export function useCandidateSubmissions() {
  const { user, isGuest } = useAuth();
  const candidateId = portalCandidateId(user?.id ?? null, isGuest);

  return useQuery({
    queryKey: portalKeys.candidateSubmissions(candidateId || "none"),
    queryFn: () => listCandidateSubmissions(candidateId),
    enabled: Boolean(candidateId),
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
  });
}

/**
 * One hackathon's judge workspace: submissions, analysis readiness and scores.
 *
 * The query key includes the code and the viewer, so switching archives never
 * shows another event's projects and a stale cache cannot leak between judges.
 */
export function useJudgeWorkspace(code: string) {
  const { user, isGuest } = useAuth();
  const viewerId = portalJudgeId(user?.id ?? null);

  return useQuery({
    queryKey: portalKeys.workspace(code, viewerId),
    queryFn: () => fetchHackathonWorkspace(code, { userId: user?.id ?? null, isGuest }),
    enabled: Boolean(code),
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
  });
}

/** One submission as the judge's project page (submission + analysis + scores). */
export function useJudgeProject(code: string, submissionId: string) {
  const { user, isGuest } = useAuth();
  const viewerId = portalJudgeId(user?.id ?? null);

  return useQuery({
    queryKey: portalKeys.project(code, submissionId, viewerId),
    queryFn: () => fetchJudgeProject(code, submissionId, { userId: user?.id ?? null, isGuest }),
    enabled: Boolean(code) && Boolean(submissionId),
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
  });
}

/** The candidate's own submission status — never judge-only data. */
export function useCandidateStatus(submissionId: string) {
  const { user, isGuest } = useAuth();
  const candidateId = portalCandidateId(user?.id ?? null, isGuest);

  return useQuery({
    queryKey: portalKeys.candidateStatus(submissionId, candidateId || "none"),
    queryFn: () =>
      fetchCandidateStatus(submissionId, candidateId, {
        userId: user?.id ?? null,
        isGuest,
      }),
    enabled: Boolean(submissionId) && Boolean(candidateId),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    // While the analysis is still working, the candidate's page refreshes itself
    // instead of asking them to reload; once it is ready, polling stops.
    refetchInterval: (query) => {
      const status = query.state.data?.submission.status;
      return status === "submitted" || status === "processing" ? 5_000 : false;
    },
  });
}

/** The hackathons this viewer organizes or judges. */
export function useJudgeHackathons() {
  const { user } = useAuth();
  const viewerId = portalJudgeId(user?.id ?? null);

  return useQuery({
    queryKey: portalKeys.judgeHackathons(viewerId || "none"),
    queryFn: () => listJudgeHackathons(viewerId),
    enabled: Boolean(viewerId),
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
  });
}
