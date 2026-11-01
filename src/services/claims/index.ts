/**
 * Claim pipeline — extraction from the deck and README, normalization into one
 * format, deduplication, registration (verification against inspected
 * evidence), and the deterministic claim scoring the report shows.
 */

export * from "./types";
export * from "./extract";
export * from "./register";
