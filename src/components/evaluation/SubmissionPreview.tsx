import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SampleBadge } from "@/components/evaluation/shared";
import { cn } from "@/lib/utils";
import type { ProjectDetail, ResumeDetail } from "@/types/evaluation";
import {
  Award,
  Briefcase,
  ExternalLink,
  FileText,
  FolderGit2,
  GraduationCap,
  Image as ImageIcon,
  Info,
  Link2,
  MapPin,
  Presentation,
  Users,
  Wrench,
} from "lucide-react";

/**
 * Submission previews.
 *
 * A judge evaluates while reading, so the preview is the left column of the
 * detail screen: the submission exactly as it was handed in, with sections the
 * submission does not carry labelled as absent instead of silently omitted (the
 * judge should not have to guess whether a resume has no education or whether the
 * page failed to render it).
 */

function EmptySection({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border/70 px-3 py-2.5 text-xs text-muted-foreground">
      {children}
    </p>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-xs text-foreground/90">
      {children}
    </span>
  );
}

function SourceLine({ source }: { source: ResumeDetail["source"] }) {
  if (source === "demo") return <SampleBadge />;
  if (source === "guest") {
    return (
      <Badge variant="outline" className="text-[10px]">
        This browser
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px]">
      Workspace
    </Badge>
  );
}

/* ------------------------------------------------------------------ resume */

export function ResumePreview({ resume }: { resume: ResumeDetail }) {
  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-border/70 bg-card">
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{resume.name}</h2>
                <SourceLine source={resume.source} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {resume.headline ?? resume.subtitle ?? "Candidate submission"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {resume.location && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" aria-hidden /> {resume.location}
                  </span>
                )}
                {resume.yearsExperience !== null && (
                  <span className="inline-flex items-center gap-1">
                    <Briefcase className="h-3.5 w-3.5" aria-hidden /> {resume.yearsExperience} years
                  </span>
                )}
                {resume.createdAt && (
                  <span>Submitted {new Date(resume.createdAt).toLocaleDateString()}</span>
                )}
                {/* Contact details stay off the judging screen on purpose. */}
                <span className="inline-flex items-center gap-1 text-muted-foreground/80">
                  <Info className="h-3.5 w-3.5" aria-hidden /> Contact details withheld
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {resume.links.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1.5 text-xs transition-colors hover:border-primary/40 hover:text-primary"
                >
                  <Link2 className="h-3.5 w-3.5" aria-hidden /> {link.label}
                </a>
              ))}
            </div>
          </div>

          {resume.summary ? (
            <p className="mt-4 text-sm leading-relaxed text-foreground/90">{resume.summary}</p>
          ) : (
            <div className="mt-4">
              <EmptySection>No candidate summary was submitted.</EmptySection>
            </div>
          )}

          {resume.skills.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {resume.skills.map((skill) => (
                <Chip key={skill}>{skill}</Chip>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <PreviewSection icon={Briefcase} title="Experience" count={resume.experience.length}>
        {resume.experience.length === 0 ? (
          <EmptySection>No work history in this submission.</EmptySection>
        ) : (
          <ol className="space-y-4">
            {resume.experience.map((entry, index) => (
              <li
                key={`${entry.title}-${index}`}
                className="relative border-l border-border/70 pl-4"
              >
                <span
                  className="absolute -left-[3px] top-1.5 h-2 w-2 rounded-full bg-primary/60"
                  aria-hidden
                />
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{entry.title}</p>
                  {entry.period && (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {entry.period}
                    </span>
                  )}
                </div>
                {entry.organization && (
                  <p className="text-xs text-muted-foreground">{entry.organization}</p>
                )}
                {entry.summary && (
                  <p className="mt-1.5 text-sm leading-relaxed text-foreground/85">
                    {entry.summary}
                  </p>
                )}
                {entry.highlights.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {entry.highlights.map((highlight) => (
                      <li key={highlight} className="flex gap-2 text-sm text-foreground/85">
                        <span
                          className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/70"
                          aria-hidden
                        />
                        {highlight}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </PreviewSection>

      <PreviewSection icon={FolderGit2} title="Projects" count={resume.projects.length}>
        {resume.projects.length === 0 ? (
          <EmptySection>No project section in this submission.</EmptySection>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {resume.projects.map((project) => (
              <li
                key={project.name}
                className="rounded-lg border border-border/70 bg-background/40 p-3"
              >
                <p className="text-sm font-medium">{project.name}</p>
                {project.summary && (
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {project.summary}
                  </p>
                )}
                {project.technologies.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {project.technologies.map((tech) => (
                      <span
                        key={tech}
                        className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {tech}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </PreviewSection>

      <div className="grid gap-5 sm:grid-cols-2">
        <PreviewSection icon={GraduationCap} title="Education" count={resume.education.length}>
          {resume.education.length === 0 ? (
            <EmptySection>No education section in this submission.</EmptySection>
          ) : (
            <ul className="space-y-3">
              {resume.education.map((entry, index) => (
                <li key={`${entry.qualification}-${index}`}>
                  <p className="text-sm font-medium">{entry.qualification}</p>
                  <p className="text-xs text-muted-foreground">
                    {[entry.institution, entry.period].filter(Boolean).join(" · ")}
                  </p>
                  {entry.detail && (
                    <p className="mt-1 text-xs text-muted-foreground">{entry.detail}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </PreviewSection>

        <PreviewSection icon={Award} title="Achievements" count={resume.achievements.length}>
          {resume.achievements.length === 0 ? (
            <EmptySection>No achievements listed.</EmptySection>
          ) : (
            <ul className="space-y-2">
              {resume.achievements.map((achievement) => (
                <li key={achievement} className="flex gap-2 text-sm text-foreground/85">
                  <Award className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden />
                  {achievement}
                </li>
              ))}
            </ul>
          )}
        </PreviewSection>
      </div>

      {resume.resumeDocument && (
        <Card className="border-border/70 bg-card/60">
          <CardContent className="flex items-center gap-3 p-4">
            <FileText className="h-5 w-5 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{resume.resumeDocument.name}</p>
              <p className="text-xs text-muted-foreground">Attached resume document</p>
            </div>
            {resume.resumeDocument.url ? (
              <a
                href={resume.resumeDocument.url}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Open <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            ) : (
              <span className="text-xs text-muted-foreground">Preview unavailable</span>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PreviewSection({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof Briefcase;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border/70 bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          <span className="inline-flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
            {title}
          </span>
          <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/* ----------------------------------------------------------------- project */

export function ProjectPreview({ project }: { project: ProjectDetail }) {
  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-border/70 bg-card">
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{project.name}</h2>
                <SourceLine source={project.source} />
                {project.projectCategory && (
                  <Badge variant="outline" className="text-[10px]">
                    {project.projectCategory}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {project.team ?? project.subtitle ?? "Independent project submission"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {project.createdAt && (
                  <span>Submitted {new Date(project.createdAt).toLocaleDateString()}</span>
                )}
                {project.teamMembers.length > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" aria-hidden /> {project.teamMembers.length}{" "}
                    members
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {project.repoUrl && (
                <a
                  href={project.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1.5 text-xs transition-colors hover:border-primary/40 hover:text-primary"
                >
                  <FolderGit2 className="h-3.5 w-3.5" aria-hidden /> Repository
                </a>
              )}
              {project.demoUrl && (
                <a
                  href={project.demoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1.5 text-xs transition-colors hover:border-primary/40 hover:text-primary"
                >
                  <Presentation className="h-3.5 w-3.5" aria-hidden /> Live demo
                </a>
              )}
            </div>
          </div>

          {project.description ? (
            <p className="mt-4 text-sm leading-relaxed text-foreground/90">{project.description}</p>
          ) : (
            <div className="mt-4">
              <EmptySection>No short description was submitted.</EmptySection>
            </div>
          )}

          {project.technologies.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <Wrench className="mr-1 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {project.technologies.map((tech) => (
                <Chip key={tech}>{tech}</Chip>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 sm:grid-cols-2">
        <Card className="border-border/70 bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Problem statement</CardTitle>
          </CardHeader>
          <CardContent>
            {project.problemStatement ? (
              <p className="text-sm leading-relaxed text-foreground/85">
                {project.problemStatement}
              </p>
            ) : (
              <EmptySection>This submission did not include a problem statement.</EmptySection>
            )}
          </CardContent>
        </Card>
        <Card className="border-border/70 bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Solution</CardTitle>
          </CardHeader>
          <CardContent>
            {project.solution ? (
              <p className="text-sm leading-relaxed text-foreground/85">{project.solution}</p>
            ) : (
              <EmptySection>No solution description was submitted.</EmptySection>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70 bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Media</CardTitle>
        </CardHeader>
        <CardContent>
          {project.media.length === 0 ? (
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-border/70 px-3 py-4 text-xs text-muted-foreground">
              <ImageIcon className="h-4 w-4" aria-hidden />
              No screenshots or recordings were attached — judge from the repository and demo link.
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {project.media.map((item) => (
                <li key={item.label} className="overflow-hidden rounded-lg border border-border/70">
                  <div className="grid h-32 place-items-center bg-muted/40 text-xs text-muted-foreground">
                    <ImageIcon className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="truncate text-xs">{item.label}</span>
                    {item.url && (
                      <a href={item.url} className="text-xs text-primary hover:underline">
                        Open
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 sm:grid-cols-2">
        <Card className="border-border/70 bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Team</CardTitle>
          </CardHeader>
          <CardContent>
            {project.teamMembers.length === 0 ? (
              <EmptySection>No team members were listed.</EmptySection>
            ) : (
              <ul className="space-y-2">
                {project.teamMembers.map((member) => (
                  <li key={member.name} className="flex items-baseline justify-between gap-3">
                    <span className="text-sm">{member.name}</span>
                    {member.role && (
                      <span className="text-xs text-muted-foreground">{member.role}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Submission details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2">
              {project.submitted.map((entry) => (
                <div key={entry.label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-muted-foreground">{entry.label}</dt>
                  <dd className="text-sm">{entry.value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function SubmissionPreview({
  detail,
  className,
}: {
  detail: ResumeDetail | ProjectDetail;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      {detail.category === "resume" ? (
        <ResumePreview resume={detail} />
      ) : (
        <ProjectPreview project={detail} />
      )}
    </div>
  );
}
