-- ---------------------------------------------------------------------------
-- 0009 — project sources
--
-- A project row written by the Candidate Portal is the backing record of a
-- hackathon submission; a project row written in the workspace is managed work.
-- They share one table (the judge reads the submission's project by id), but
-- they are different entities: the Project Manager's Projects listing must be a
-- view of managed work only, never a mirror of the submission inbox.
--
-- `source` stores that classification on the row itself, so the separation
-- lives in the data model and every query can only mix the two by explicitly
-- ignoring it — not by a component-level filter someone can bypass.
--
-- Existing rows are classified, not deleted or duplicated: a project that any
-- submission points at was created by that submission and becomes
-- 'candidate_submission'; everything else was workspace work and keeps the
-- 'project_manager' default.
-- ---------------------------------------------------------------------------

alter table public.projects
  add column if not exists source text not null default 'project_manager';

alter table public.projects
  drop constraint if exists projects_source_check;

alter table public.projects
  add constraint projects_source_check
    check (source in ('project_manager', 'candidate_submission'));

-- Backfill from the authoritative relationship: hackathon_submissions.project_id.
-- A row referenced by a submission is a candidate submission's project — that
-- is a fact recorded at submit time, not something to infer from names or dates.
update public.projects p
set source = 'candidate_submission'
where exists (
  select 1 from public.hackathon_submissions s
  where s.project_id = p.id
);

-- The Project Manager listing filters on (user_id, source); serve it from one
-- index so the workspace pages stay as fast as before the column existed.
create index if not exists public.projects_user_source_idx
  on public.projects (user_id, source);

comment on column public.projects.source is
  'Who created the row: a candidate Portal submission (candidate_submission) or the project-management workflow (project_manager). The Projects listing selects only project_manager rows; submission project rows stay readable by id for status, progress and judge detail.';
