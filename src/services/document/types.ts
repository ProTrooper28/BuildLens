/**
 * Document analysis — PPT/PDF extraction and claim extraction types.
 *
 * Extraction runs in the browser (PPTX unzipped with fflate, PDF text layer
 * via pdfjs-dist, scanned pages/images via tesseract.js OCR when available).
 * The output is persisted into `reports.report_data.document_analysis` and
 * handed to the evaluation agent as explicit, UNVERIFIED claims from the
 * submitted document — never as facts.
 */

export type DocumentKind = "pdf" | "pptx" | "image" | "unsupported";

export type ExtractionMethod = "native" | "ocr" | "native+ocr" | "none";

/** `partial` = some text was read but parts (e.g. scanned pages) were not. */
export type DocumentExtractionStatus = "success" | "partial" | "failed";

export type PageSource = "native" | "ocr" | "none";

export interface DocumentPage {
  /** 1-based page/slide number. */
  page: number;
  /** Readable text for this page (native layer and/or OCR result). */
  text: string;
  source: PageSource;
}

export interface DocumentExtraction {
  fileName: string;
  fileSizeBytes: number;
  kind: DocumentKind;
  totalPages: number;
  pages: DocumentPage[];
  /** All page texts joined, clipped to MAX_FULL_TEXT chars. */
  fullText: string;
  method: ExtractionMethod;
  status: DocumentExtractionStatus;
  ocrAttempted: boolean;
  ocrApplied: boolean;
  /** Set when status is `failed` (and best-effort reason for `partial`). */
  error: string | null;
  warnings: string[];
  extractedAt: string;
}

export type ClaimCategoryKey = "problem" | "solution" | "features" | "technology" | "impact";

export interface DocumentClaims {
  /** Short "what the team says this does" summary. */
  summary: string | null;
  problem: string[];
  solution: string[];
  features: string[];
  technology: string[];
  impact: string[];
  /** How the claims were produced. `llm` reserved for a future model pass. */
  method: "heuristic" | "llm";
}

/** In-memory result of `analyzeDocumentFile`. */
export interface DocumentAnalysis {
  extraction: DocumentExtraction;
  claims: DocumentClaims | null;
}

/**
 * Persisted shape inside `reports.report_data.document_analysis`.
 * Field names are snake_case to match the rest of the analyst payload.
 */
export interface DocumentAnalysisPayload {
  status: DocumentExtractionStatus | "pending";
  file_name: string | null;
  file_type: string | null;
  total_pages: number | null;
  chars_extracted: number | null;
  method: ExtractionMethod | null;
  ocr_applied: boolean | null;
  error: string | null;
  warnings: string[];
  /**
   * Light per-page stats plus a short text preview. The preview is what lets a
   * claim cite "PDF page 7" without storing the whole document.
   */
  pages: { page: number; chars: number; source: PageSource; text: string | null }[];
  claims: DocumentClaims | null;
  summary: string | null;
  extracted_at: string | null;
  /** Fixed disclaimer rendered next to the claims everywhere they appear. */
  disclaimer: string;
}

/** Shown wherever document claims appear — claims are assertions, not facts. */
export const DOCUMENT_CLAIMS_DISCLAIMER =
  "Claims from the submitted document — these are the team's own assertions, not automatically verified facts. The evaluation pipeline compares them against the GitHub repository and the deployed website.";

/** `EvaluationSubmission.presentation.text` is capped at 120 000 chars. */
export const MAX_FULL_TEXT = 120_000;

/** Claim list presentation limits (shared by UI and payload builders). */
export const MAX_CLAIMS_PER_CATEGORY = 8;
export const MAX_CLAIM_CHARS = 240;
