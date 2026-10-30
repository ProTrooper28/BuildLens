/**
 * Project inspection.
 *
 *   project-type — which kind of project this is, so the strategy matches
 *   report       — the deterministic judge verdict + ten evidence sections
 *
 * The report is built from the evidence bundle and the run's structured result;
 * it never calls a model, so the judge summary works even when AI is unavailable.
 */

export * from "./types";
export { detectProjectType, requiredInputs, type ProjectTypeResult } from "./project-type";
export { buildInspectionReport, type InspectionInput } from "./report";
