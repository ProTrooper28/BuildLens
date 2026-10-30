/**
 * Document analysis service — the entry point the review form calls.
 *
 * `analyzeDocumentFile(file)` extracts readable text from the uploaded
 * PPT/PDF/image (with OCR fallback where the runtime supports it) and pulls
 * the team's claims out of that text. The result is:
 *   - shown to the judge in the "Document Analysis" panel (with loading,
 *     success and failure states), and
 *   - persisted into `reports.report_data.document_analysis`, which the
 *     evaluation pipeline hands to the AI judge as explicit UNVERIFIED claims
 *     to compare against GitHub/deployed-site evidence.
 */

import { extractDocumentClaims } from "./claims";
import { extractDocumentText } from "./extract";
import {
  DOCUMENT_CLAIMS_DISCLAIMER,
  type DocumentAnalysis,
  type DocumentAnalysisPayload,
  type DocumentClaims,
  type DocumentExtraction,
} from "./types";

export * from "./types";
export { extractDocumentClaims, claimCount } from "./claims";
export { extractDocumentText, detectDocumentKind } from "./extract";
export { isOcrSupported } from "./ocr";

/**
 * Read a Blob/File's bytes across runtimes: `arrayBuffer()` where available
 * (modern browsers, Node), `FileReader` elsewhere (older jsdom in tests).
 */
async function readBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Extract text + claims from one uploaded file.
 *
 * Never rejects — an unreadable document yields `extraction.status: "failed"`
 * with a reason, and `claims: null`, so the submission flow can continue and
 * the judge can see exactly why nothing was read.
 */
export async function analyzeDocumentFile(
  file: File | Blob,
  fileName?: string,
): Promise<DocumentAnalysis> {
  const name = fileName ?? (file instanceof File && file.name ? file.name : "presentation");
  let data: Uint8Array;
  try {
    data = await readBytes(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    const extraction: DocumentExtraction = {
      fileName: name,
      fileSizeBytes: 0,
      kind: "unsupported",
      totalPages: 0,
      pages: [],
      fullText: "",
      method: "none",
      status: "failed",
      ocrAttempted: false,
      ocrApplied: false,
      error: `The file could not be read (${message}).`,
      warnings: [],
      extractedAt: new Date().toISOString(),
    };
    return { extraction, claims: null };
  }

  const extraction = await extractDocumentText({ data, name });
  const claims =
    extraction.status !== "failed" && extraction.fullText.trim().length > 0
      ? extractDocumentClaims(extraction.fullText)
      : null;
  return { extraction, claims };
}

/** Build the `report_data.document_analysis` payload for a finished run. */
export function toDocumentAnalysisPayload(
  extraction: DocumentExtraction | null,
  claims: DocumentClaims | null,
): DocumentAnalysisPayload | null {
  if (!extraction) return null;
  return {
    status: extraction.status,
    file_name: extraction.fileName,
    file_type: extraction.kind,
    total_pages: extraction.totalPages,
    chars_extracted: extraction.fullText.trim().length,
    method: extraction.method,
    ocr_applied: extraction.ocrApplied,
    error: extraction.error,
    warnings: extraction.warnings,
    pages: extraction.pages.map((page) => ({
      page: page.page,
      chars: page.text.trim().length,
      source: page.source,
      // Preview only — enough to locate a claim, not the whole slide.
      text: page.text.trim().slice(0, 600) || null,
    })),
    claims,
    summary: claims?.summary ?? null,
    extracted_at: extraction.extractedAt,
    disclaimer: DOCUMENT_CLAIMS_DISCLAIMER,
  };
}

/** Convenience: payload builder straight from an in-memory analysis. */
export function documentAnalysisPayloadOf(
  analysis: DocumentAnalysis | null,
): DocumentAnalysisPayload | null {
  if (!analysis) return null;
  return toDocumentAnalysisPayload(analysis.extraction, analysis.claims);
}
