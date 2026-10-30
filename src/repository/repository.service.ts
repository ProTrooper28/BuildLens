/**
 * Public repository inspection.
 *
 * Uses only unauthenticated, publicly accessible endpoints (GitHub REST and
 * GitLab API). No GitHub token, Supabase service key or any other credential is
 * read here, so this module is safe to run in the browser. Private repositories
 * are deliberately unsupported: both providers answer 404 for repositories the
 * caller cannot see, and we never attempt to bypass that.
 */

import {
  AnalysisError,
  type RepositoryFile,
  type RepositoryMetadata,
  type RepositoryProvider,
  type RepositoryRef,
  type RepositorySnapshot,
} from "@/analysis/types";

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_README_CHARS = 40_000;

const SUPPORTED_HOSTS: Record<string, RepositoryProvider> = {
  "github.com": "github",
  "www.github.com": "github",
  "gitlab.com": "gitlab",
  "www.gitlab.com": "gitlab",
};

/** Page routes that can follow the repository path in a web URL. */
const WEB_ROUTES = new Set([
  "tree",
  "blob",
  "commit",
  "commits",
  "issues",
  "pulls",
  "merge_requests",
  "releases",
  "actions",
  "wiki",
  "tags",
  "branches",
]);

export type ParseResult = { ok: true; ref: RepositoryRef } | { ok: false; error: AnalysisError };

/**
 * Parse and validate a repository URL.
 *
 * Accepts `https://github.com/owner/repo`, optionally with `.git`, a trailing
 * slash, or extra path segments (e.g. `/tree/main`). Rejects non-http URLs,
 * unsupported hosts and paths that cannot identify a repository.
 */
export function parseRepositoryUrl(input: string | null | undefined): ParseResult {
  const raw = (input ?? "").trim();
  if (!raw) {
    return {
      ok: false,
      error: new AnalysisError(
        "invalid-url",
        "A repository URL is required to analyze this project.",
        "Use a public GitHub or GitLab repository URL, e.g. https://github.com/owner/repo.",
      ),
    };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return {
      ok: false,
      error: new AnalysisError(
        "invalid-url",
        "That repository URL is not a valid URL.",
        "Use a full URL starting with https://, e.g. https://github.com/owner/repo.",
      ),
    };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      error: new AnalysisError(
        "invalid-url",
        "Only http(s) repository URLs can be analyzed.",
        "Use the public web URL of the repository.",
      ),
    };
  }

  const provider = SUPPORTED_HOSTS[url.hostname.toLowerCase()];
  if (!provider) {
    return {
      ok: false,
      error: new AnalysisError(
        "unsupported-provider",
        `BuildLens can only analyze public GitHub or GitLab repositories — ${url.hostname} is not supported.`,
        "Submit a github.com or gitlab.com URL.",
      ),
    };
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return {
      ok: false,
      error: new AnalysisError(
        "invalid-url",
        "That URL points at a host, not a repository.",
        "Include the owner and repository name, e.g. https://github.com/owner/repo.",
      ),
    };
  }

  // GitHub is always `owner/repo`. GitLab supports nested groups
  // (`group/subgroup/repo`), and both providers append page routes such as
  // `/tree/main` — those are dropped before the repository is identified.
  const routeIndex = segments.findIndex(
    (segment) => segment.startsWith("-") || WEB_ROUTES.has(segment.toLowerCase()),
  );
  const pathSegments = (routeIndex === -1 ? segments : segments.slice(0, routeIndex))
    .map((segment) => segment.replace(/\.git$/i, ""))
    .filter(Boolean);

  const owner = pathSegments[0] ?? "";
  const repo = provider === "gitlab" ? pathSegments.slice(1).join("/") : (pathSegments[1] ?? "");
  if (!owner || !repo) {
    return {
      ok: false,
      error: new AnalysisError(
        "invalid-url",
        "That URL is missing the repository owner or name.",
        "Use https://github.com/owner/repo.",
      ),
    };
  }

  const host = provider === "github" ? "github.com" : "gitlab.com";
  return {
    ok: true,
    ref: {
      provider,
      owner,
      repo,
      url: `https://${host}/${owner}/${repo}`,
    },
  };
}

/* --------------------------------------------------------------- transport */

interface RequestOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function request(
  url: string,
  { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS }: RequestOptions,
  accept: string,
): Promise<{ body: string; headers: Headers; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: accept },
    });
    const body = await response.text();
    return { body, headers: response.headers, status: response.status };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new AnalysisError(
        "timeout",
        "The repository provider took too long to respond.",
        "Try again in a moment; very large repositories can time out.",
      );
    }
    throw new AnalysisError(
      "network",
      "We couldn't reach the repository provider.",
      "Check the repository URL, or try again if your connection was interrupted.",
    );
  } finally {
    clearTimeout(timer);
  }
}

function mapHttpError(status: number, body: string, headers: Headers): AnalysisError {
  if (status === 404) {
    return new AnalysisError(
      "not-found",
      "Repository not found — it may not exist, or it may be private.",
      "BuildLens only analyzes public repositories. Check the URL or make the repository public.",
    );
  }
  if (status === 401 || status === 403 || status === 429) {
    const limitedRemaining = headers.get("x-ratelimit-remaining");
    if (status === 429 || limitedRemaining === "0" || /rate limit/i.test(body)) {
      const reset = headers.get("x-ratelimit-reset");
      const resetHint = reset
        ? ` GitHub's public rate limit resets at ${new Date(Number(reset) * 1000).toLocaleTimeString()}.`
        : "";
      return new AnalysisError(
        "rate-limited",
        "The repository provider is rate limiting anonymous requests.",
        `Public analysis runs without credentials, so requests are limited.${resetHint} Try again later.`,
      );
    }
    return new AnalysisError(
      "not-found",
      "Repository not accessible — it may be private.",
      "BuildLens only analyzes public repositories.",
    );
  }
  if (status >= 500) {
    return new AnalysisError(
      "network",
      "The repository provider returned an error.",
      "This is usually temporary — retry the analysis.",
    );
  }
  return new AnalysisError("unexpected", `Repository provider returned HTTP ${status}.`);
}

async function requestJson<T>(
  url: string,
  options: RequestOptions,
): Promise<{ data: T; headers: Headers }> {
  const { body, headers, status } = await request(url, options, "application/vnd.github+json");
  if (status < 200 || status >= 300) throw mapHttpError(status, body, headers);
  try {
    return { data: JSON.parse(body) as T, headers };
  } catch {
    throw new AnalysisError(
      "malformed-repository",
      "The provider returned a response we couldn't read.",
      "Retry the analysis; if it keeps failing the repository may be empty or malformed.",
    );
  }
}

/**
 * Read one file from a public repository (raw content, no credentials).
 *
 * Used by the evidence layer to inspect a handful of targeted files (extension
 * manifest, dependency files, authentication entry points) instead of trusting
 * a README. Returns null when the file cannot be read, so callers never treat a
 * failed read as proof of anything.
 */
export async function fetchRepositoryFile(
  ref: RepositoryRef,
  branch: string,
  path: string,
  options: RequestOptions = {},
): Promise<string | null> {
  const url =
    ref.provider === "github" ? githubRawUrl(ref, branch, path) : gitlabRawUrl(ref, branch, path);
  return requestText(url, options);
}

async function requestText(url: string, options: RequestOptions): Promise<string | null> {
  try {
    const { body, headers, status } = await request(url, options, "text/plain");
    if (status < 200 || status >= 300) return null;
    return body;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- providers */

interface GithubRepoResponse {
  full_name?: string;
  description?: string | null;
  default_branch?: string;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  license?: { spdx_id?: string | null; name?: string | null } | null;
  homepage?: string | null;
  archived?: boolean;
  pushed_at?: string | null;
  size?: number;
  languages_url?: string;
  private?: boolean;
  message?: string;
}

interface GithubTreeResponse {
  tree?: { path?: string; type?: string; size?: number }[];
  truncated?: boolean;
}

interface GitlabProjectResponse {
  path_with_namespace?: string;
  description?: string | null;
  default_branch?: string;
  star_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  license?: { name?: string | null } | null;
  web_url?: string;
  archived?: boolean;
  last_activity_at?: string | null;
  message?: string;
}

interface GitlabTreeEntry {
  path?: string;
  type?: string;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  rb: "Ruby",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  swift: "Swift",
  php: "PHP",
  cs: "C#",
  cpp: "C++",
  c: "C",
  h: "C",
  scss: "SCSS",
  css: "CSS",
  html: "HTML",
  sql: "SQL",
  sh: "Shell",
  vue: "Vue",
  svelte: "Svelte",
  dart: "Dart",
  ex: "Elixir",
};

/** Estimate a language mix from file extensions when the provider has no stats. */
export function languagesFromFiles(files: RepositoryFile[]): { name: string; pct: number }[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const ext = file.path.split(".").pop()?.toLowerCase();
    if (!ext) continue;
    const language = LANGUAGE_BY_EXTENSION[ext];
    if (!language) continue;
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  if (total === 0) return [];
  return [...counts.entries()]
    .map(([name, count]) => ({ name, pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
}

function githubRawUrl(ref: RepositoryRef, branch: string, path: string): string {
  return `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${encodeURIComponent(branch)}/${path}`;
}

function gitlabRawUrl(ref: RepositoryRef, branch: string, path: string): string {
  return `https://gitlab.com/${ref.owner}/${ref.repo}/-/raw/${encodeURIComponent(branch)}/${path}`;
}

function toFileList(
  tree: { path?: string; type?: string; size?: number }[] | undefined,
): RepositoryFile[] {
  if (!Array.isArray(tree)) return [];
  return tree
    .filter((entry) => typeof entry.path === "string" && entry.type !== "tree")
    .map((entry) => ({ path: entry.path as string, size: entry.size ?? null }));
}

async function inspectGithub(
  ref: RepositoryRef,
  options: RequestOptions,
): Promise<RepositorySnapshot> {
  const limitations: string[] = [];
  const base = `https://api.github.com/repos/${ref.owner}/${ref.repo}`;
  const { data: repo } = await requestJson<GithubRepoResponse>(base, options);

  if (!repo || typeof repo !== "object" || !repo.default_branch) {
    throw new AnalysisError(
      "malformed-repository",
      "The repository metadata is incomplete or unreadable.",
      "Check that the repository is public and has at least one commit.",
    );
  }

  const branch = repo.default_branch;
  const { data: tree } = await requestJson<GithubTreeResponse>(
    `${base}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    options,
  );
  const files = toFileList(tree.tree);
  if (tree.truncated) {
    limitations.push(
      "The repository tree was truncated by GitHub — very large repositories are only partially inspected.",
    );
  }
  if (files.length === 0) {
    throw new AnalysisError(
      "malformed-repository",
      "The repository appears to be empty.",
      "Push at least one commit to the default branch and retry the analysis.",
    );
  }

  let languages: { name: string; pct: number }[] = [];
  if (repo.languages_url) {
    try {
      const { data } = await requestJson<Record<string, number>>(repo.languages_url, options);
      const total = Object.values(data).reduce((sum, value) => sum + value, 0);
      if (total > 0) {
        languages = Object.entries(data)
          .map(([name, bytes]) => ({ name, pct: Math.round((bytes / total) * 100) }))
          .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
      }
    } catch {
      limitations.push(
        "Language statistics were unavailable; the mix was estimated from file extensions.",
      );
    }
  }
  if (languages.length === 0) languages = languagesFromFiles(files);

  const packagePath = files.find((file) => file.path === "package.json")?.path;
  let packageJson: Record<string, unknown> | null = null;
  if (packagePath) {
    const raw = await requestText(githubRawUrl(ref, branch, packagePath), options);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          packageJson = parsed as Record<string, unknown>;
        }
      } catch {
        limitations.push(
          "package.json could not be parsed, so dependency-based detection was skipped.",
        );
      }
    }
  }

  const readmeFile = files.find((file) => /^readme(\.|$)/i.test(file.path));
  let readme: { path: string; text: string } | null = null;
  if (readmeFile) {
    const raw = await requestText(githubRawUrl(ref, branch, readmeFile.path), options);
    if (raw) readme = { path: readmeFile.path, text: raw.slice(0, MAX_README_CHARS) };
    else limitations.push("README content could not be downloaded.");
  }

  const metadata: RepositoryMetadata = {
    fullName: repo.full_name ?? `${ref.owner}/${ref.repo}`,
    description: repo.description ?? null,
    defaultBranch: branch,
    stars: typeof repo.stargazers_count === "number" ? repo.stargazers_count : null,
    forks: typeof repo.forks_count === "number" ? repo.forks_count : null,
    openIssues: typeof repo.open_issues_count === "number" ? repo.open_issues_count : null,
    license: repo.license?.spdx_id ?? repo.license?.name ?? null,
    homepage: repo.homepage ?? null,
    archived: Boolean(repo.archived),
    pushedAt: repo.pushed_at ?? null,
    sizeKb: typeof repo.size === "number" ? repo.size : null,
    languages,
  };

  return {
    ref,
    metadata,
    files,
    truncated: Boolean(tree.truncated),
    readme,
    packageJson,
    inspectedAt: new Date().toISOString(),
    limitations,
  };
}

async function inspectGitlab(
  ref: RepositoryRef,
  options: RequestOptions,
): Promise<RepositorySnapshot> {
  const limitations: string[] = [];
  const projectPath = encodeURIComponent(`${ref.owner}/${ref.repo}`);
  const { data: project } = await requestJson<GitlabProjectResponse>(
    `https://gitlab.com/api/v4/projects/${projectPath}`,
    options,
  );

  if (!project || typeof project !== "object" || !project.default_branch) {
    throw new AnalysisError(
      "malformed-repository",
      "The repository metadata is incomplete or unreadable.",
      "Check that the repository is public and has at least one commit.",
    );
  }

  const branch = project.default_branch;
  const { data: tree } = await requestJson<GitlabTreeEntry[]>(
    `https://gitlab.com/api/v4/projects/${projectPath}/repository/tree?recursive=true&per_page=100&ref=${encodeURIComponent(branch)}`,
    options,
  );
  const files: RepositoryFile[] = Array.isArray(tree)
    ? tree
        .filter((entry) => typeof entry.path === "string" && entry.type !== "tree")
        .map((entry) => ({ path: entry.path as string, size: null }))
    : [];
  if (files.length >= 100) {
    limitations.push("Only the first 100 files of this GitLab repository were inspected.");
  }
  if (files.length === 0) {
    throw new AnalysisError(
      "malformed-repository",
      "The repository appears to be empty.",
      "Push at least one commit to the default branch and retry the analysis.",
    );
  }

  const languages = languagesFromFiles(files);
  if (languages.length === 0) {
    limitations.push(
      "No recognised source file extensions were found, so no language mix could be detected.",
    );
  }

  const packagePath = files.find((file) => file.path === "package.json")?.path;
  let packageJson: Record<string, unknown> | null = null;
  if (packagePath) {
    const raw = await requestText(gitlabRawUrl(ref, branch, packagePath), options);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          packageJson = parsed as Record<string, unknown>;
        }
      } catch {
        limitations.push(
          "package.json could not be parsed, so dependency-based detection was skipped.",
        );
      }
    }
  }

  const readmeFile = files.find((file) => /^readme(\.|$)/i.test(file.path));
  let readme: { path: string; text: string } | null = null;
  if (readmeFile) {
    const raw = await requestText(gitlabRawUrl(ref, branch, readmeFile.path), options);
    if (raw) readme = { path: readmeFile.path, text: raw.slice(0, MAX_README_CHARS) };
    else limitations.push("README content could not be downloaded.");
  }

  const metadata: RepositoryMetadata = {
    fullName: project.path_with_namespace ?? `${ref.owner}/${ref.repo}`,
    description: project.description ?? null,
    defaultBranch: branch,
    stars: typeof project.star_count === "number" ? project.star_count : null,
    forks: typeof project.forks_count === "number" ? project.forks_count : null,
    openIssues: typeof project.open_issues_count === "number" ? project.open_issues_count : null,
    license: project.license?.name ?? null,
    homepage: project.web_url ?? null,
    archived: Boolean(project.archived),
    pushedAt: project.last_activity_at ?? null,
    sizeKb: null,
    languages,
  };

  return {
    ref,
    metadata,
    files,
    truncated: files.length >= 100,
    readme,
    packageJson,
    inspectedAt: new Date().toISOString(),
    limitations,
  };
}

/**
 * Fetch metadata and a file listing for a public repository.
 *
 * Throws `AnalysisError` with a user-facing message for every failure mode.
 */
export async function fetchRepositorySnapshot(
  ref: RepositoryRef,
  options: RequestOptions = {},
): Promise<RepositorySnapshot> {
  return ref.provider === "github" ? inspectGithub(ref, options) : inspectGitlab(ref, options);
}
