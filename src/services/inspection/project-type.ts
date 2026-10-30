/**
 * Project-type detection.
 *
 * A hackathon cohort is not all websites: an extension has no site, a mobile app
 * has a store listing, an ML project has notebooks. The type decides which
 * evidence is required and which gaps are real gaps, so it is detected from
 * structural signals first (extension manifest, platform folders, firmware
 * files) and from the submission's own wording only as a fallback.
 */

import type { EvidenceObservation } from "@/services/evidence/types";
import type { ProjectType } from "./types";

export interface ProjectTypeInput {
  observations: readonly EvidenceObservation[];
  technologies: readonly string[];
  /** Description, solution and extracted claims, joined. */
  text: string;
  /** True when the deployed page was actually read. */
  hasReadableWebsite: boolean;
}

export interface ProjectTypeResult {
  type: ProjectType;
  confidence: "high" | "medium" | "low";
  /** What decided the type — shown in the detailed analysis. */
  reasons: string[];
}

interface Rule {
  type: ProjectType;
  /** Observation ids produced by the repository reader. */
  observationIds: string[];
  pattern: RegExp;
  label: string;
}

/**
 * Order is deliberate: the more specific platform wins over “web app”, so an AI
 * project that also ships a demo page is classified as an AI project.
 */
const RULES: Rule[] = [
  {
    type: "browser_extension",
    observationIds: ["repo.type.extension"],
    pattern: /\b(browser extension|chrome extension|firefox add-?on|manifest v[23]|content script)\b/i,
    label: "extension manifest / wording",
  },
  {
    type: "mobile_app",
    observationIds: ["repo.type.mobile"],
    pattern:
      /\b(react native|flutter|swiftui|android studio|ios app|android app|mobile app|play store|app store)\b/i,
    label: "mobile framework, platform folders or wording",
  },
  {
    type: "desktop_app",
    observationIds: ["repo.type.desktop"],
    pattern: /\b(electron|tauri|desktop app|windows app|macos app|\.exe|installer)\b/i,
    label: "desktop framework or packaging wording",
  },
  {
    type: "hardware_iot",
    observationIds: ["repo.type.hardware"],
    pattern:
      /\b(arduino|esp32|esp8266|raspberry pi|firmware|microcontroller|iot device|sensor(s)?|pcb|kicad)\b/i,
    label: "firmware/design files or hardware wording",
  },
  {
    type: "ai_model",
    observationIds: ["repo.type.ml"],
    pattern:
      /\b(machine learning|deep learning|neural network|model training|training pipeline|dataset|inference|llm|large language model|computer vision|nlp|fine-?tun(e|ing))\b/i,
    label: "ML dependencies, notebooks or model wording",
  },
  {
    type: "cli_tool",
    observationIds: ["repo.type.cli"],
    pattern: /\b(cli|command[- ]line|developer tool|terminal tool|npm package|shell tool)\b/i,
    label: "CLI entry point or wording",
  },
  {
    type: "web_app",
    observationIds: [],
    pattern: /\b(web app|web application|website|saas|dashboard|browser[- ]based)\b/i,
    label: "a deployed page was read / web wording",
  },
  {
    type: "api_backend",
    observationIds: ["repo.code.api"],
    pattern: /\b(api|backend|back[- ]end|microservice|server[- ]side|rest service)\b/i,
    label: "server routes or API wording",
  },
];

export function detectProjectType(input: ProjectTypeInput): ProjectTypeResult {
  const ids = new Set(input.observations.map((entry) => entry.id));
  const haystack = `${input.text} ${input.technologies.join(" ")}`.toLowerCase();

  for (const rule of RULES) {
    const structural = rule.observationIds.filter((id) => ids.has(id));
    const wording = rule.pattern.test(haystack);
    if (rule.type === "web_app") {
      if (input.hasReadableWebsite) {
        return {
          type: "web_app",
          confidence: "high",
          reasons: ["The submitted deployed URL answered and was read as a web page."],
        };
      }
      if (wording) {
        return {
          type: "web_app",
          confidence: "low",
          reasons: ["The submission describes a web application, but no deployed page was read."],
        };
      }
      continue;
    }
    if (structural.length > 0) {
      return {
        type: rule.type,
        confidence: "high",
        reasons: [`Detected from ${rule.label}.`],
      };
    }
    if (wording) {
      return {
        type: rule.type,
        confidence: "medium",
        reasons: [`Inferred from the submission's own wording (${rule.label}).`],
      };
    }
  }

  if (input.hasReadableWebsite) {
    return {
      type: "web_app",
      confidence: "medium",
      reasons: ["A deployed page was read, so the project was inspected as a web application."],
    };
  }

  return {
    type: "other",
    confidence: "low",
    reasons: [
      "No decisive platform signal was found (no manifest, platform folder, firmware file or recognisable wording).",
    ],
  };
}

/** Which inputs are genuinely required for this project type. */
export function requiredInputs(type: ProjectType): {
  website: boolean;
  repository: boolean;
  deck: boolean;
} {
  return {
    // Only a web app is expected to ship a public page. An API, CLI, extension
    // or model may legitimately have no site; a site that IS provided is still
    // inspected for every type.
    website: type === "web_app",
    repository: type !== "other",
    deck: true,
  };
}
