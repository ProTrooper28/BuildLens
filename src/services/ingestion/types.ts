/**
 * Evidence ingestion seam.
 *
 * The agent never fetches anything itself: each external source is a separate
 * service implementing `EvidenceIngestor` and registered with the pipeline.
 * The evaluation works without them — a source that is not connected yet
 * simply reports `pending`, and that gap is handed to the model as an explicit
 * "unverified" signal (claims depending on it can never be marked verified).
 *
 * Today's services (kept deliberately separate, one file each):
 *   document-ocr — PPT/PDF text + claims, pre-extracted in the browser by
 *                  src/services/document and passed through here
 *   web          — the deployed site, fetched and reduced to readable facts
 *   github       — the public repository via services/repository + the
 *                  existing analyzers (same analysis the report pipeline runs)
 *
 * Each outcome also carries `facts`/`url`, which the unified evidence layer
 * (services/evidence) turns into per-claim statuses.
 */

import type { EvaluationSubmission } from "@/services/evaluation-agent/schema";
import type { EvidenceObservation, EvidenceSegment } from "@/services/evidence/types";

export type IngestionKind = "document" | "website" | "repository";

export type IngestionStatus = "ingested" | "pending" | "failed";

export interface IngestionOutcome {
  kind: IngestionKind;
  status: IngestionStatus;
  /** Extracted text handed to the model; null until the service produces it. */
  text: string | null;
  /** Why it is pending/failed — surfaced to the model as an evidence gap. */
  detail: string;
  /** What was actually read, as short facts (never inferred): versions, files, status codes. */
  facts?: string[];
  /** The URL this source was read from, when there is one. */
  url?: string | null;
  /**
   * Structured checks behind the facts — what was checked, what was found and
   * the exact evidence (URL, header, file path). Produced only by the source
   * readers, so the judge UI can show them without asking the model.
   */
  observations?: EvidenceObservation[];
  /**
   * The same evidence split by where it came from, so claim comparison can
   * require implementation/runtime support and cite a file path or URL. A
   * README is a `documentation` segment and never verifies a claim on its own.
   */
  segments?: EvidenceSegment[];
}

export interface EvidenceIngestor {
  kind: IngestionKind;
  label: string;
  /** False while the underlying service is not connected. */
  isAvailable(): boolean;
  /** Never throws for expected conditions — report `pending`/`failed` instead. */
  ingest(submission: EvaluationSubmission): Promise<IngestionOutcome>;
}

/** An ingestor violated its contract (unexpected throw is wrapped as failed). */
export class IngestionError extends Error {
  readonly kind: IngestionKind;
  constructor(kind: IngestionKind, message: string) {
    super(message);
    this.name = "IngestionError";
    this.kind = kind;
  }
}
