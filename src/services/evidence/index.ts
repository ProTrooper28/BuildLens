/**
 * Unified evidence layer.
 *
 *   sources/  — one reader per evidence source (repository, deployed site, deck)
 *   compare   — deterministic claim → status comparison
 *   bundle    — the object the AI judge and the judge UI both consume
 *
 * Adding a source = implementing the ingestion interface in
 * `services/ingestion`; it is picked up here with no changes to the pipeline.
 */

export * from "./types";
export {
  claimsFromSubmission,
  buildEvidenceBundle,
  claimsFromDocumentation,
  claimNatureOf,
  isNearDuplicateClaim,
} from "./bundle";
export { compareClaims, assembleBundle, sourcesFromOutcomes, type ClaimInput } from "./compare";
export { EVIDENCE_CONCEPTS, type EvidenceConcept } from "./concepts";
export { repositoryEvidence } from "./repository-source";
export { websiteEvidence } from "./website-source";
