/**
 * Repository evidence source.
 *
 * Reuses the exact services the product already runs for its report pipeline —
 * `parseRepositoryUrl`, `fetchRepositorySnapshot` (public GitHub/GitLab REST, no
 * credentials) and the analyzers in `src/analysis/analyzers` — and goes one step
 * further than the README: a handful of targeted files (extension manifest,
 * dependency files, container/deploy config, authentication entry points) are
 * read so claims can be compared with actual implementation signals.
 *
 * A README is a CLAIM SOURCE, never a verification source. Every observation
 * here names what was read (file path or dependency) or says it was not found.
 * Nothing is inferred beyond what the API and those files returned, and a
 * repository that cannot be read stays an explicit gap.
 */

import type { EvaluationSubmission } from "@/services/evaluation-agent/schema";
import {
  fetchRepositoryFile,
  fetchRepositorySnapshot,
  parseRepositoryUrl,
} from "@/repository/repository.service";
import { analyzeDocumentation } from "@/analysis/analyzers/documentation.analyzer";
import { analyzeMaintainability } from "@/analysis/analyzers/maintainability.analyzer";
import { analyzeQuality } from "@/analysis/analyzers/quality.analyzer";
import { analyzeSecurity } from "@/analysis/analyzers/security.analyzer";
import { analyzeStack } from "@/analysis/analyzers/stack.analyzer";
import { analyzeTesting } from "@/analysis/analyzers/testing.analyzer";
import type { RepositoryFile, RepositorySnapshot } from "@/analysis/types";
import type { IngestionOutcome } from "../ingestion/types";
import { evidenceFetch } from "../ingestion/http";
import type { EvidenceObservation, EvidenceSegment, ObservationStatus } from "./types";

const MAX_README_CHARS = 6_000;
const MAX_FILE_CHARS = 24_000;
/** Files read beyond the snapshot's README/package.json. Kept small on purpose. */
const MAX_EXTRA_FILES = 9;
/** Extra files opened because the team's own claim words point at them. */
const MAX_CLAIM_FILES = 3;

/* Which files are worth reading for implementation evidence. */
const TARGET_FILE_PATTERNS: RegExp[] = [
  /(^|\/)manifest\.json$/i,
  /^requirements\.txt$/i,
  /^pyproject\.toml$/i,
  /^pubspec\.yaml$/i,
  /^Cargo\.toml$/i,
  /^go\.mod$/i,
  /^Dockerfile$/i,
  /^docker-compose\.ya?ml$/i,
  /^\.env\.example$/i,
];

/** Entry points that usually carry authentication or middleware wiring. */
const AUTH_FILE =
  /(^|\/)(auth|auth\.config|authorize|middleware|session|login|signin|oauth)[^/]*\.(ts|tsx|js|jsx|mjs|py|go|rb|java|kt|swift|php)$/i;

const AUTH_DEPENDENCIES = [
  "next-auth",
  "@auth/core",
  "@auth0/nextjs-auth0",
  "passport",
  "jsonwebtoken",
  "bcrypt",
  "bcryptjs",
  "@clerk/nextjs",
  "@clerk/clerk-react",
  "firebase-admin",
  "@supabase/auth-helpers-nextjs",
  "@supabase/ssr",
  "lucia",
  "iron-session",
  "express-session",
  "flask-login",
  "django-allauth",
  "python-jose",
  "pyjwt",
];

const DATA_DEPENDENCIES = [
  "pg",
  "postgres",
  "mysql2",
  "mongoose",
  "mongodb",
  "redis",
  "ioredis",
  "prisma",
  "@prisma/client",
  "drizzle-orm",
  "supabase",
  "@supabase/supabase-js",
  "firebase",
  "firebase-admin",
];

const MOBILE_DEPENDENCIES = [
  "react-native",
  "expo",
  "@capacitor/core",
  "cordova",
  "@ionic/react",
  "flutter",
];

const DESKTOP_DEPENDENCIES = ["electron", "@tauri-apps/api", "@electron-forge/cli", "nw"];

const ML_DEPENDENCIES = [
  "torch",
  "pytorch",
  "tensorflow",
  "torchvision",
  "transformers",
  "scikit-learn",
  "sklearn",
  "keras",
  "xgboost",
  "lightgbm",
  "sentence-transformers",
  "onnxruntime",
  "langchain",
  "openai",
  "anthropic",
  "@anthropic-ai/sdk",
];

const API_DEPENDENCIES = [
  "express",
  "fastify",
  "koa",
  "hapi",
  "@nestjs/core",
  "fastapi",
  "flask",
  "django",
  "uvicorn",
  "gunicorn",
  "rails",
  "phoenix",
  "actix-web",
  "axum",
];

interface ExtensionManifest {
  manifest_version?: number;
  name?: string;
  permissions?: unknown;
  host_permissions?: unknown;
  content_scripts?: unknown;
  background?: unknown;
  action?: unknown;
  browser_action?: unknown;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… [truncated]` : text;
}

function packageJsonDetails(packageJson: Record<string, unknown> | null): {
  dependencies: string[];
  scripts: string[];
  hasBin: boolean;
} {
  if (!packageJson) return { dependencies: [], scripts: [], hasBin: false };
  const dependencies = Object.keys({
    ...(typeof packageJson["dependencies"] === "object" && packageJson["dependencies"]
      ? (packageJson["dependencies"] as Record<string, unknown>)
      : {}),
    ...(typeof packageJson["devDependencies"] === "object" && packageJson["devDependencies"]
      ? (packageJson["devDependencies"] as Record<string, unknown>)
      : {}),
  }).sort();
  const scripts =
    typeof packageJson["scripts"] === "object" && packageJson["scripts"]
      ? Object.keys(packageJson["scripts"] as Record<string, unknown>).sort()
      : [];
  const hasBin = Boolean(packageJson["bin"]);
  return { dependencies, scripts, hasBin };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function observation(
  id: string,
  label: string,
  status: ObservationStatus,
  result: string,
  evidence: string[],
  confidence: EvidenceObservation["confidence"],
  area: EvidenceObservation["area"] = "repository",
): EvidenceObservation {
  return { id, area, label, status, result, evidence, confidence };
}

function matchingFiles(files: RepositoryFile[], patterns: RegExp[]): RepositoryFile[] {
  return files.filter((file) => patterns.some((pattern) => pattern.test(file.path)));
}

function hasDependency(dependencies: readonly string[], names: readonly string[]): string[] {
  const declared = dependencies.map((dependency) => dependency.toLowerCase());
  return names.filter((name) => declared.includes(name.toLowerCase()));
}

function hasPath(files: RepositoryFile[], pattern: RegExp): string[] {
  return files.filter((file) => pattern.test(file.path)).map((file) => file.path);
}

/** Words that describe any project, so they never select a file to read. */
const CLAIM_STOPWORDS = new Set([
  "about",
  "after",
  "allow",
  "allows",
  "based",
  "build",
  "built",
  "capable",
  "complete",
  "could",
  "create",
  "deliver",
  "designed",
  "develop",
  "enable",
  "ensure",
  "every",
  "feature",
  "features",
  "helping",
  "helps",
  "implant",
  "implement",
  "include",
  "integrated",
  "make",
  "makes",
  "offer",
  "offers",
  "people",
  "platform",
  "product",
  "provide",
  "provides",
  "quality",
  "real-time",
  "solution",
  "solutions",
  "support",
  "supports",
  "system",
  "systems",
  "their",
  "these",
  "those",
  "using",
  "users",
  "using",
  "which",
  "would",
]);

/**
 * Words from the team's own claims (deck features, technology, solution and the
 * form description) used to pick a few more files to read. A claim about
 * "recommendations" should be checked against `src/lib/recommendations.ts`,
 * not against the README that mentions it.
 */
function claimKeywords(submission: EvaluationSubmission): string[] {
  const deck = submission.presentation?.claims ?? null;
  const source = [
    ...(deck?.features ?? []),
    ...(deck?.technology ?? []),
    ...(deck?.solution ?? []),
    submission.solution ?? "",
    submission.description ?? "",
  ].join(" ");
  const words = source.toLowerCase().match(/[a-z][a-z0-9-]{4,}/g) ?? [];
  return [...new Set(words)]
    .filter((word) => !CLAIM_STOPWORDS.has(word))
    .slice(0, 24);
}

/** Read a bounded set of targeted files; unreadable files are simply absent. */
async function readTargetFiles(
  snapshot: RepositorySnapshot,
  authCandidates: RepositoryFile[],
  featureCandidates: RepositoryFile[],
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();
  const candidates = [
    ...matchingFiles(snapshot.files, TARGET_FILE_PATTERNS),
    ...authCandidates.slice(0, 2),
    ...featureCandidates.slice(0, MAX_CLAIM_FILES),
  ]
    .filter((file) => (file.size ?? 0) < 80_000)
    .slice(0, MAX_EXTRA_FILES);

  await Promise.all(
    candidates.map(async (file) => {
      const text = await fetchRepositoryFile(snapshot.ref, snapshot.metadata.defaultBranch, file.path, {
        fetchImpl: evidenceFetch(),
      });
      if (text !== null) contents.set(file.path, text.slice(0, MAX_FILE_CHARS));
    }),
  );
  return contents;
}

/** Read a submission's public repository into an evidence outcome. */
export async function repositoryEvidence(
  submission: EvaluationSubmission,
): Promise<IngestionOutcome> {
  const raw = submission.repoUrl?.trim() ?? "";
  if (!raw) {
    return {
      kind: "repository",
      status: "pending",
      text: null,
      detail: "No GitHub repository URL was provided with the submission.",
      facts: [],
      url: null,
      observations: [
        observation(
          "repo.readable",
          "Repository readable",
          "could_not_verify",
          "No repository URL was submitted, so no code could be inspected.",
          ["No repoUrl on the submission"],
          "high",
        ),
      ],
    };
  }

  const parsed = parseRepositoryUrl(raw);
  if (!parsed.ok) {
    return {
      kind: "repository",
      status: "failed",
      text: null,
      detail: `The repository URL could not be read (${parsed.error.message}) — repository claims are unverified.`,
      facts: [],
      url: raw,
      observations: [
        observation(
          "repo.readable",
          "Repository readable",
          "could_not_verify",
          "The repository URL is not a public GitHub/GitLab address, so no code could be inspected.",
          [`Submitted value: ${clip(raw, 160)}`],
          "high",
        ),
      ],
    };
  }

  let snapshot: RepositorySnapshot;
  try {
    snapshot = await fetchRepositorySnapshot(parsed.ref, { fetchImpl: evidenceFetch() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      kind: "repository",
      status: "failed",
      text: null,
      detail: `${parsed.ref.url} could not be inspected (${message}) — repository claims are unverified, which is not evidence that they are false.`,
      facts: [`Fetch failed: ${message}`],
      url: parsed.ref.url,
      observations: [
        observation(
          "repo.readable",
          "Repository readable",
          "could_not_verify",
          "The repository did not answer the public API, so no code could be inspected. Private or deleted repositories look the same as missing ones.",
          [`${parsed.ref.url}: ${message}`],
          "high",
        ),
      ],
    };
  }

  const stack = analyzeStack(snapshot);
  const testing = analyzeTesting(snapshot);
  const documentation = analyzeDocumentation(snapshot);
  const security = analyzeSecurity(snapshot);
  const quality = analyzeQuality(snapshot);
  const maintainability = analyzeMaintainability(snapshot);
  const { dependencies, scripts, hasBin } = packageJsonDetails(snapshot.packageJson);

  const languages = snapshot.metadata.languages
    .map((language) => `${language.name} ${language.pct}%`)
    .join(", ");
  const frameworks = stack.frameworks.map((framework) => framework.name);
  const configFiles = stack.configFiles;
  const testFiles = snapshot.files
    .filter(
      (file) =>
        /(^|\/)(__tests__|tests?)\//.test(file.path) || /\.(test|spec)\.[a-z]+$/.test(file.path),
    )
    .map((file) => file.path);

  const authCandidates = snapshot.files.filter(
    (file) => AUTH_FILE.test(file.path) && (file.size ?? 0) < 40_000,
  );
  // Files whose names carry the team's own claim words ("recommendations",
  // "payments", "dashboard"): the place a claim like that would live.
  const keywords = claimKeywords(submission);
  const featureCandidates = snapshot.files.filter((file) => {
    const path = file.path.toLowerCase();
    if (AUTH_FILE.test(file.path)) return false;
    if (TARGET_FILE_PATTERNS.some((pattern) => pattern.test(file.path))) return false;
    if (/(^|\/)(tests?|__tests__|spec|docs?|examples?|e2e)\//.test(path)) return false;
    if (/(^|\/)(readme|license|changelog|contributing)[^/]*$/.test(path)) return false;
    if (/\.(test|spec)\./.test(path)) return false;
    if (/(^|\/)(package-lock\.json|bun\.lock|yarn\.lock|pnpm-lock\.yaml)$/.test(path)) return false;
    if ((file.size ?? 0) >= 40_000) return false;
    return keywords.some((keyword) => path.includes(keyword));
  });
  const extraFiles = await readTargetFiles(snapshot, authCandidates, featureCandidates);
  const extraPaths = [...extraFiles.keys()];

  const manifestPath = extraPaths.find((path) => /(^|\/)manifest\.json$/i.test(path));
  let manifest: ExtensionManifest | null = null;
  if (manifestPath) {
    try {
      const parsedManifest = JSON.parse(extraFiles.get(manifestPath) ?? "") as unknown;
      if (parsedManifest && typeof parsedManifest === "object") {
        manifest = parsedManifest as ExtensionManifest;
      }
    } catch {
      manifest = null;
    }
  }

  const dependencySignals = {
    auth: hasDependency(dependencies, AUTH_DEPENDENCIES),
    data: hasDependency(dependencies, DATA_DEPENDENCIES),
    mobile: hasDependency(dependencies, MOBILE_DEPENDENCIES),
    desktop: hasDependency(dependencies, DESKTOP_DEPENDENCIES),
    ml: hasDependency(dependencies, ML_DEPENDENCIES),
    api: hasDependency(dependencies, API_DEPENDENCIES),
  };

  const contentHaystack = [...extraFiles.entries()]
    .map(([path, content]) => `# ${path}\n${content}`)
    .join("\n")
    .toLowerCase();

  const authPaths = [
    ...authCandidates.map((file) => file.path),
    ...extraPaths.filter((path) => AUTH_FILE.test(path)),
  ];
  const authContentSignals = [
    "signinwithoauth",
    "signinwithemail",
    "oauth",
    "passport",
    "jwt",
    "jsonwebtoken",
    "bcrypt",
    "session",
    "authorize(",
    "auth()",
  ].filter((needle) => contentHaystack.includes(needle));

  const mobilePaths = hasPath(snapshot.files, /(^|\/)(android|ios)\//i).slice(0, 6);
  const desktopPaths = hasPath(snapshot.files, /(^|\/)(src-tauri|electron)\//i).slice(0, 4);
  const mlPaths = hasPath(snapshot.files, /\.(ipynb|onnx|pt|pth|h5|pkl)$/i).slice(0, 6);
  const hardwarePaths = hasPath(snapshot.files, /(\.ino$|platformio\.ini$|\.kicad_|\.fzz$)/i).slice(
    0,
    6,
  );
  const apiPaths = hasPath(
    snapshot.files,
    /(^|\/)(api|server|backend|routes)\/[^/]+\.(ts|tsx|js|py|go|rb|php)$/i,
  ).slice(0, 6);
  const workflowPaths = hasPath(snapshot.files, /(^|\/)\.github\/workflows\/.+\.ya?ml$/i);
  const deployPaths = hasPath(
    snapshot.files,
    /(^|\/)(Dockerfile|docker-compose\.ya?ml|vercel\.json|netlify\.toml|fly\.toml|render\.yaml|Procfile|app\.yaml)$/i,
  ).slice(0, 6);
  const cliPaths = [
    ...(hasBin && snapshot.packageJson ? ["package.json (bin)"] : []),
    ...hasPath(snapshot.files, /(^|\/)(cli|bin|cmd)\//i).slice(0, 4),
  ];

  /* ---------------------------------------------------------- observations */

  const observations: EvidenceObservation[] = [
    observation(
      "repo.readable",
      "Repository readable",
      "good",
      `The public repository was read: ${snapshot.files.length} files on the default branch.`,
      [`${snapshot.metadata.fullName} (${snapshot.ref.url})`, `Default branch: ${snapshot.metadata.defaultBranch}`],
      "high",
    ),
    observation(
      "repo.stack",
      "Language and framework signals",
      frameworks.length > 0 || languages ? "info" : "could_not_verify",
      frameworks.length > 0
        ? `Frameworks detected from config files and dependencies: ${frameworks.join(", ")}.`
        : "No framework could be detected from the repository's configuration and dependency files.",
      [
        languages ? `Languages: ${languages}` : "Languages: not detected",
        frameworks.length > 0 ? `Frameworks: ${frameworks.join(", ")}` : "Frameworks: none",
        ...configFiles.slice(0, 8),
      ],
      "high",
    ),
    observation(
      "repo.code.auth",
      "Authentication implementation",
      dependencySignals.auth.length > 0 || authPaths.length > 0
        ? "good"
        : authContentSignals.length > 0
          ? "good"
          : "not_detected",
      dependencySignals.auth.length > 0 || authPaths.length > 0
        ? "Authentication wiring was found in the repository: an auth dependency and/or auth entry-point files are present."
        : authContentSignals.length > 0
          ? "No auth dependency or conventional auth file was found, but auth-related code appears in the inspected files."
          : "No authentication dependency, auth entry-point file or auth code was detected in the files that were read. Authentication may still exist elsewhere.",
      [
        ...dependencySignals.auth.map((dependency) => `package.json: ${dependency}`),
        ...authPaths.slice(0, 5),
        ...authContentSignals.slice(0, 5).map((signal) => `code contains “${signal}”`),
      ],
      dependencySignals.auth.length > 0 || authPaths.length > 0 ? "medium" : "low",
    ),
    observation(
      "repo.code.api",
      "Backend / API implementation",
      dependencySignals.api.length > 0 || apiPaths.length > 0 ? "good" : "not_detected",
      dependencySignals.api.length > 0 || apiPaths.length > 0
        ? "Server-side code is present: a backend dependency and/or API route files were found."
        : "No backend framework dependency or API route directory was detected in the file listing.",
      [
        ...dependencySignals.api.map((dependency) => `package.json: ${dependency}`),
        ...apiPaths,
      ],
      "medium",
    ),
    observation(
      "repo.code.data",
      "Data layer",
      dependencySignals.data.length > 0 || hasPath(snapshot.files, /supabase\/migrations\//i).length > 0
        ? "info"
        : "not_detected",
      dependencySignals.data.length > 0 || hasPath(snapshot.files, /supabase\/migrations\//i).length > 0
        ? "A database or storage dependency was declared in the repository."
        : "No database client dependency was detected in the dependency files that were read.",
      [
        ...dependencySignals.data.map((dependency) => `package.json: ${dependency}`),
        ...hasPath(snapshot.files, /supabase\/migrations\//i).slice(0, 3),
      ],
      "medium",
    ),
    observation(
      "repo.code.tests",
      "Automated tests",
      testFiles.length > 0 ? "good" : "warning",
      testFiles.length > 0
        ? `${testFiles.length} test file${testFiles.length === 1 ? "" : "s"} were found in the repository.`
        : "No test files were found in the repository listing.",
      testFiles.slice(0, 6),
      "high",
    ),
    observation(
      "repo.code.ci",
      "Continuous integration",
      workflowPaths.length > 0 ? "good" : "not_detected",
      workflowPaths.length > 0
        ? `${workflowPaths.length} CI workflow file${workflowPaths.length === 1 ? "" : "s"} found.`
        : "No CI configuration (.github/workflows, .gitlab-ci.yml) was found.",
      workflowPaths.slice(0, 4),
      "high",
    ),
    observation(
      "repo.code.docs",
      "Documentation",
      documentation.readmePath ? "good" : "warning",
      documentation.readmePath
        ? `README present (${documentation.readmeChars} characters at ${documentation.readmePath}).`
        : "No README was found in the repository listing.",
      documentation.readmePath ? [documentation.readmePath] : [],
      "high",
    ),
    observation(
      "repo.code.deployment",
      "Deployment configuration",
      deployPaths.length > 0 ? "info" : "not_detected",
      deployPaths.length > 0
        ? "Deployment or container configuration was found in the repository."
        : "No container or hosting configuration was found in the repository listing.",
      deployPaths,
      "medium",
    ),
    observation(
      "repo.code.dependencies",
      "Dependencies",
      dependencies.length > 0 ? "info" : "could_not_verify",
      dependencies.length > 0
        ? `${dependencies.length} declared dependenc${dependencies.length === 1 ? "y" : "ies"} were read from package.json.`
        : "No package.json dependency list was available.",
      [dependencies.slice(0, 12).join(", ") || "none", scripts.slice(0, 8).join(", ")],
      "high",
    ),
    observation(
      "repo.quality",
      "Code-quality signals",
      quality.score === null ? "could_not_verify" : quality.score >= 70 ? "good" : "warning",
      quality.score === null
        ? "No code-quality signal could be computed from the file listing."
        : `Structural code-quality signal: ${quality.score}/100. ${quality.summary}`,
      quality.findings?.slice(0, 4) ?? [],
      "medium",
    ),
    observation(
      "repo.maintainability",
      "Maintainability signals",
      maintainability.score === null
        ? "could_not_verify"
        : maintainability.score >= 70
          ? "good"
          : "warning",
      maintainability.score === null
        ? "No maintainability signal could be computed from the file listing."
        : `Structural maintainability signal: ${maintainability.score}/100. ${maintainability.summary}`,
      [],
      "medium",
    ),
    observation(
      "repo.security.secrets",
      "Secrets and sensitive files",
      security.findingsDetailed.length > 0
        ? security.findingsDetailed.some((finding) => finding.severity === "critical")
          ? "critical"
          : "warning"
        : "not_detected",
      security.findingsDetailed.length > 0
        ? `${security.findingsDetailed.length} repository security finding${security.findingsDetailed.length === 1 ? "" : "s"} detected in committed files.`
        : "No committed-secret or sensitive-file pattern was detected in the repository listing.",
      security.findingsDetailed
        .slice(0, 5)
        .map((finding) => `${finding.title} (${finding.severity}) — ${finding.detail}`),
      "medium",
    ),
    observation(
      "repo.security.server_side",
      "Server-side security",
      "could_not_verify",
      "Code was read for implementation signals, not audited. Authorization, injection and data-handling security could not be verified from the repository listing.",
      ["No static analysis or penetration test was performed"],
      "high",
    ),
    observation(
      "repo.readme.claims",
      "README as evidence",
      "info",
      documentation.readmePath
        ? "The README was read as the team's claims. README statements alone were not treated as proof that a feature exists."
        : "There is no README to compare with the implementation.",
      documentation.readmePath ? [documentation.readmePath] : [],
      "high",
    ),
  ];

  /* --------------------------------------------------------- project type */

  if (manifest) {
    const permissions = [
      ...stringList(manifest.permissions),
      ...stringList(manifest.host_permissions),
    ];
    const broad = permissions.some(
      (permission) => permission === "<all_urls>" || permission.includes("*://*/*"),
    );
    observations.push(
      observation(
        "repo.type.extension",
        "Browser extension manifest",
        broad ? "warning" : "good",
        `A browser extension manifest (version ${manifest.manifest_version ?? "unknown"}) was found${manifest.name ? ` for “${manifest.name}”` : ""}.${broad ? " It requests access to all websites, which the judge should review." : ""}`,
        [
          `manifest: ${manifestPath}`,
          `permissions: ${permissions.length > 0 ? permissions.slice(0, 12).join(", ") : "none declared"}`,
          ...(manifest.content_scripts ? ["content_scripts declared"] : []),
          ...(manifest.background ? ["background/service worker declared"] : []),
        ],
        "high",
      ),
    );
  }
  if (dependencySignals.mobile.length > 0 || mobilePaths.length > 0) {
    observations.push(
      observation(
        "repo.type.mobile",
        "Mobile project signals",
        "info",
        "Mobile app signals were found in the repository.",
        [...dependencySignals.mobile.map((dep) => `package.json: ${dep}`), ...mobilePaths],
        "medium",
      ),
    );
  }
  if (dependencySignals.desktop.length > 0 || desktopPaths.length > 0) {
    observations.push(
      observation(
        "repo.type.desktop",
        "Desktop project signals",
        "info",
        "Desktop app signals were found in the repository.",
        [...dependencySignals.desktop.map((dep) => `package.json: ${dep}`), ...desktopPaths],
        "medium",
      ),
    );
  }
  if (dependencySignals.ml.length > 0 || mlPaths.length > 0) {
    observations.push(
      observation(
        "repo.type.ml",
        "AI / ML signals",
        "info",
        "Machine-learning or AI integration signals were found in the repository.",
        [...dependencySignals.ml.map((dep) => `dependency: ${dep}`), ...mlPaths],
        "medium",
      ),
    );
  }
  if (hardwarePaths.length > 0) {
    observations.push(
      observation(
        "repo.type.hardware",
        "Hardware / IoT signals",
        "info",
        "Firmware or hardware design files were found in the repository.",
        hardwarePaths,
        "medium",
      ),
    );
  }
  if (cliPaths.length > 0) {
    observations.push(
      observation(
        "repo.type.cli",
        "CLI / developer tool signals",
        "info",
        "Command-line entry points were found in the repository.",
        cliPaths,
        "medium",
      ),
    );
  }

  /* --------------------------------------------------------- segments */
  // Evidence split by where it comes from. The README is emitted as
  // `documentation`, which claim comparison excludes: it may state a feature,
  // it never proves one.
  const segments: EvidenceSegment[] = [];
  if (dependencies.length > 0 || scripts.length > 0) {
    segments.push({
      ref: "GitHub: package.json",
      kind: "config",
      text: clip(
        [
          `dependencies: ${dependencies.join(", ")}`,
          `scripts: ${scripts.join(", ")}`,
          hasBin ? "bin: declared" : null,
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n"),
        MAX_FILE_CHARS,
      ),
    });
  }
  for (const [path, content] of extraFiles) {
    if (snapshot.readme && path === snapshot.readme.path) continue;
    const isMarkdown = /\.md$/i.test(path);
    const isConfig = /\.(json|ya?ml|toml|txt|lock|cfg|ini|env)$/i.test(path) || /(^|\/)Dockerfile$/i.test(path);
    segments.push({
      ref: `GitHub: ${path}`,
      kind: isMarkdown ? "documentation" : isConfig ? "config" : "implementation",
      text: clip(content, MAX_FILE_CHARS),
    });
  }
  segments.push({
    ref: `GitHub: ${snapshot.metadata.fullName} file list`,
    kind: "implementation",
    text: clip(snapshot.files.map((file) => file.path).join("\n"), MAX_FILE_CHARS),
  });
  if (snapshot.readme) {
    segments.push({
      ref: `GitHub: ${snapshot.readme.path}`,
      kind: "documentation",
      text: clip(snapshot.readme.text, MAX_README_CHARS),
    });
  }

  /* --------------------------------------------------------- prompt facts */

  const facts: string[] = [
    `Repository ${snapshot.metadata.fullName} read via ${snapshot.ref.provider === "github" ? "GitHub" : "GitLab"} (default branch ${snapshot.metadata.defaultBranch}).`,
    `${snapshot.files.length} files listed${snapshot.truncated ? " (listing truncated by the provider)" : ""}.`,
  ];
  if (languages) facts.push(`Languages: ${languages}.`);
  if (frameworks.length > 0) facts.push(`Frameworks detected: ${frameworks.join(", ")}.`);
  if (stack.packageManager) facts.push(`Package manager: ${stack.packageManager}.`);
  if (dependencies.length > 0) facts.push(`Declared dependencies: ${dependencies.join(", ")}.`);
  if (scripts.length > 0) facts.push(`Package scripts: ${scripts.join(", ")}.`);
  facts.push(
    testFiles.length > 0
      ? `${testFiles.length} test file${testFiles.length === 1 ? "" : "s"} (${testFiles.slice(0, 5).join(", ")}).`
      : "No test files were found in the listing.",
  );
  if (documentation.readmePath) {
    facts.push(`README: ${documentation.readmePath} (${documentation.readmeChars} characters).`);
  } else {
    facts.push("No README was found in the repository listing.");
  }
  if (configFiles.length > 0) facts.push(`Config files: ${configFiles.join(", ")}.`);
  if (security.findingsDetailed.length > 0) {
    facts.push(
      `Security findings: ${security.findingsDetailed
        .slice(0, 4)
        .map((finding) => `${finding.title} (${finding.severity})`)
        .join("; ")}.`,
    );
  } else {
    facts.push("No committed-secret or configuration problems were detected in the listing.");
  }
  if (quality.score !== null) facts.push(`Code-quality signal score: ${quality.score}/100.`);
  if (maintainability.score !== null) {
    facts.push(`Maintainability signal score: ${maintainability.score}/100.`);
  }
  if (extraPaths.length > 0) facts.push(`Files read beyond the README: ${extraPaths.join(", ")}.`);

  const inspectionSummary = observations
    .map((entry) => `- ${entry.label} [${entry.status}]: ${entry.result}`)
    .join("\n");

  const text = [
    `Repository: ${snapshot.metadata.fullName} (${snapshot.ref.url})`,
    snapshot.metadata.description ? `Description: ${snapshot.metadata.description}` : null,
    languages ? `Languages: ${languages}` : null,
    frameworks.length > 0 ? `Frameworks: ${frameworks.join(", ")}` : null,
    `Files listed: ${snapshot.files.length}`,
    dependencies.length > 0 ? `Dependencies: ${dependencies.join(", ")}` : null,
    scripts.length > 0 ? `Scripts: ${scripts.join(", ")}` : null,
    testFiles.length > 0
      ? `Test files: ${testFiles.slice(0, 10).join(", ")}`
      : "Test files: none found",
    `Code quality: ${quality.summary}`,
    `Security: ${security.summary}`,
    `Testing: ${testing.summary}`,
    `Documentation: ${documentation.summary}`,
    `Maintainability: ${maintainability.summary}`,
    `Repository inspection:\n${inspectionSummary}`,
    snapshot.readme
      ? `README (${snapshot.readme.path}):\n${clip(snapshot.readme.text, MAX_README_CHARS)}`
      : "README: none found",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  return {
    kind: "repository",
    status: "ingested",
    text,
    detail: `Repository ${snapshot.metadata.fullName} was inspected: ${snapshot.files.length} files, ${extraPaths.length} targeted file${extraPaths.length === 1 ? "" : "s"} read, README ${documentation.readmePath ? "present" : "missing"}, ${testFiles.length} test files.`,
    facts,
    url: snapshot.ref.url,
    observations,
    segments,
  };
}
