import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import {
  listCandidateSubmissions,
  listJudgeHackathons,
  portalCandidateId,
  portalJudgeId,
} from "@/services/hackathon.service";

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
