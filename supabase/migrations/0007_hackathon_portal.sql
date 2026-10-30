-- BuildLens — shared hackathon portal
--
-- Connects the candidate portal and the judge portal to one record set.
--
--   hackathons            the event: unique code (join/submission code), name,
--                         description, status, dates and its evaluation criteria
--   hackathon_judges      which judges may see and score that event
--   hackathon_submissions one candidate's submission for one event
--
-- `hackathon_submissions.id` is the **canonical project id** used by both
-- portals, the analysis run, the evidence bundle, judge evaluations, scoring,
-- ranking and reports. `project_id` / `report_id` point at the existing
-- `projects` / `reports` rows, so nothing is copied: the submission *is* the
-- project, and the candidate's own workspace page and the judge's detail page
-- read the same row.
--
-- Isolation is enforced here, not in the client:
--   * a candidate reads only their own submissions;
--   * a judge reads only submissions of hackathons they own or are assigned to;
--   * a submission's hackathon and candidate are immutable (trigger).
--
-- Join codes are resolved through `join_hackathon(code)` (security definer), so
-- a candidate can join a hackathon with its code without being able to list or
-- enumerate other events.
--
-- Additive: nothing existing is altered except the read policies on
-- `document_extractions` and `judge_evaluations`, which are narrowed so an
-- authenticated user can no longer read every extraction / every score in the
-- database.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $enum$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'hackathon_status'
  ) then
    create type public.hackathon_status as enum ('draft', 'open', 'judging', 'complete');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'submission_status'
  ) then
    -- The lifecycle both portals display, in order.
    create type public.submission_status as enum (
      'submitted',    -- received, queued for analysis
      'processing',   -- documents / repository / deployment being read
      'analyzed',     -- evidence bundle exists, waiting for a judge
      'under_review', -- a judge started scoring
      'evaluated',    -- a judge submitted a score
      'finalized'     -- the result is published to the candidate
    );
  end if;
end;
$enum$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.hackathons (
  id          uuid primary key default gen_random_uuid(),
  -- The code a candidate types. Unique, case-insensitive, and the only way a
  -- candidate can address an event.
  code        text not null,
  name        text not null,
  description text,
  status      public.hackathon_status not null default 'open',
  starts_at   timestamptz,
  ends_at     timestamptz,
  -- The rubric the judge scores this event with (same shape as
  -- evaluation_criteria_sets.criteria), so each hackathon carries its own
  -- criteria instead of sharing one global rubric.
  criteria    jsonb not null default '[]'::jsonb,
  max_score   integer not null default 1000 check (max_score between 10 and 10000),
  created_by  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists hackathons_code_unique
  on public.hackathons (upper(code));
create index if not exists hackathons_created_by_idx
  on public.hackathons (created_by);

create table if not exists public.hackathon_judges (
  hackathon_id uuid not null references public.hackathons (id) on delete cascade,
  judge_id     uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (hackathon_id, judge_id)
);

create index if not exists hackathon_judges_judge_idx
  on public.hackathon_judges (judge_id);

create table if not exists public.hackathon_submissions (
  id              uuid primary key default gen_random_uuid(),
  hackathon_id    uuid not null references public.hackathons (id) on delete cascade,
  candidate_id    uuid not null references public.profiles (id) on delete cascade,
  -- The workspace rows the submission was created from (not copies).
  project_id      uuid references public.projects (id) on delete set null,
  report_id       uuid references public.reports (id) on delete set null,
  team_name       text not null,
  team_members    jsonb not null default '[]'::jsonb,
  description     text,
  repo_url        text,
  website_url     text,
  demo_url        text,
  deck_name       text,
  status          public.submission_status not null default 'submitted',
  -- ai_evaluation_runs.id (that column is text).
  analysis_run_id text,
  -- Only ever set by a judge, and only when the result may be shown to the team.
  result_published boolean not null default false,
  published_result jsonb,
  published_at    timestamptz,
  submitted_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- One submission per candidate per hackathon: a double-clicked submit button
  -- updates this row instead of creating a second project.
  constraint hackathon_submissions_once_per_candidate unique (hackathon_id, candidate_id)
);

create index if not exists hackathon_submissions_hackathon_idx
  on public.hackathon_submissions (hackathon_id, submitted_at desc);
create index if not exists hackathon_submissions_candidate_idx
  on public.hackathon_submissions (candidate_id, submitted_at desc);

-- ---------------------------------------------------------------------------
-- Membership helpers (used by the policies below and by the client)
-- ---------------------------------------------------------------------------
create or replace function public.is_hackathon_judge(hackathon uuid, uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.hackathons h
    where h.id = hackathon and h.created_by = uid
  ) or exists (
    select 1 from public.hackathon_judges j
    where j.hackathon_id = hackathon and j.judge_id = uid
  );
$fn$;

revoke all on function public.is_hackathon_judge(uuid, uuid) from public;
grant execute on function public.is_hackathon_judge(uuid, uuid) to authenticated;

/**
 * Resolve a join code to its hackathon.
 *
 * Security definer on purpose: a candidate must be able to enter a code without
 * a policy that lets every candidate list every hackathon. Drafts are invisible.
 */
create or replace function public.join_hackathon(p_code text)
returns public.hackathons
language sql
stable
security definer
set search_path = public
as $fn$
  select *
  from public.hackathons
  where upper(code) = upper(btrim(p_code))
    and status <> 'draft'
  limit 1;
$fn$;

revoke all on function public.join_hackathon(text) from public;
grant execute on function public.join_hackathon(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Column / scope guard
-- ---------------------------------------------------------------------------
create or replace function public.guard_hackathon_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  judge_can_write boolean := public.is_hackathon_judge(new.hackathon_id);
begin
  if tg_op = 'UPDATE' then
    if new.hackathon_id is distinct from old.hackathon_id
       or new.candidate_id is distinct from old.candidate_id then
      raise exception 'A submission cannot be moved to another hackathon or candidate.';
    end if;

    if not judge_can_write then
      if new.status is distinct from old.status then
        raise exception 'Only a judge of this hackathon may change a submission status.';
      end if;
      if new.result_published is distinct from old.result_published
         or new.published_result is distinct from old.published_result
         or new.published_at is distinct from old.published_at then
        raise exception 'Only a judge of this hackathon may publish a result.';
      end if;
    end if;
  end if;

  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists hackathon_submissions_guard on public.hackathon_submissions;
create trigger hackathon_submissions_guard
  before insert or update on public.hackathon_submissions
  for each row execute function public.guard_hackathon_submission();

-- updated_at triggers (reuse the 0001 helper when it exists)
do $trg$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_updated_at'
  ) then
    if not exists (
      select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'hackathons'
        and t.tgname = 'hackathons_set_updated_at'
    ) then
      execute $sql$ create trigger hackathons_set_updated_at
        before update on public.hackathons
        for each row execute function public.set_updated_at() $sql$;
    end if;
  end if;
end;
$trg$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.hackathons            enable row level security;
alter table public.hackathon_judges      enable row level security;
alter table public.hackathon_submissions enable row level security;

-- Hackathons: the organizer, its judges, and candidates who already submitted
-- (they need the event's name, dates and criteria on their own status page).
drop policy if exists hackathons_select on public.hackathons;
create policy hackathons_select
  on public.hackathons for select
  to authenticated
  using (
    created_by = auth.uid()
    or public.is_hackathon_judge(id)
    or exists (
      select 1 from public.hackathon_submissions s
      where s.hackathon_id = id and s.candidate_id = auth.uid()
    )
  );

drop policy if exists hackathons_insert on public.hackathons;
create policy hackathons_insert
  on public.hackathons for insert
  to authenticated
  with check (created_by = auth.uid() and public.is_buildlens_judge());

drop policy if exists hackathons_update on public.hackathons;
create policy hackathons_update
  on public.hackathons for update
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- Judges of one event never learn about another event's judge roster.
drop policy if exists hackathon_judges_select on public.hackathon_judges;
create policy hackathon_judges_select
  on public.hackathon_judges for select
  to authenticated
  using (
    judge_id = auth.uid()
    or exists (
      select 1 from public.hackathons h
      where h.id = hackathon_id and h.created_by = auth.uid()
    )
  );

drop policy if exists hackathon_judges_write on public.hackathon_judges;
create policy hackathon_judges_write
  on public.hackathon_judges for all
  to authenticated
  using (
    exists (
      select 1 from public.hackathons h
      where h.id = hackathon_id and h.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.hackathons h
      where h.id = hackathon_id and h.created_by = auth.uid()
    )
  );

-- Submissions: the team that submitted, and the judges of that hackathon.
drop policy if exists hackathon_submissions_select on public.hackathon_submissions;
create policy hackathon_submissions_select
  on public.hackathon_submissions for select
  to authenticated
  using (candidate_id = auth.uid() or public.is_hackathon_judge(hackathon_id));

drop policy if exists hackathon_submissions_insert on public.hackathon_submissions;
create policy hackathon_submissions_insert
  on public.hackathon_submissions for insert
  to authenticated
  with check (candidate_id = auth.uid());

drop policy if exists hackathon_submissions_update on public.hackathon_submissions;
create policy hackathon_submissions_update
  on public.hackathon_submissions for update
  to authenticated
  using (candidate_id = auth.uid() or public.is_hackathon_judge(hackathon_id))
  with check (candidate_id = auth.uid() or public.is_hackathon_judge(hackathon_id));

-- A candidate may withdraw before judging starts, and only their own row.
drop policy if exists hackathon_submissions_delete on public.hackathon_submissions;
create policy hackathon_submissions_delete
  on public.hackathon_submissions for delete
  to authenticated
  using (candidate_id = auth.uid() and status = 'submitted');

-- ---------------------------------------------------------------------------
-- Judges must be able to read what was submitted
--
-- `projects` and `reports` are owner-only since 0001, which would leave a judge
-- unable to open the deck/report attached to a submission. These additive
-- policies grant *read* access on exactly those rows a submission points at,
-- and only to the judges of that hackathon. Nothing else becomes readable, and
-- the candidate's write policies are untouched.
-- ---------------------------------------------------------------------------
drop policy if exists projects_hackathon_judge_read on public.projects;
create policy projects_hackathon_judge_read
  on public.projects for select
  to authenticated
  using (
    exists (
      select 1 from public.hackathon_submissions s
      where s.project_id = projects.id
        and public.is_hackathon_judge(s.hackathon_id)
    )
  );

drop policy if exists reports_hackathon_judge_read on public.reports;
create policy reports_hackathon_judge_read
  on public.reports for select
  to authenticated
  using (
    exists (
      select 1
      from public.hackathon_submissions s
      where (s.report_id = reports.id or s.project_id = reports.project_id)
        and public.is_hackathon_judge(s.hackathon_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Tighten two earlier wide-open read policies
--
-- 0004 let *any* authenticated user read every document extraction, and 0003
-- let any judge read every evaluation — cross-event leaks. Both are narrowed to
-- the submission's own candidate and that hackathon's judges.
-- ---------------------------------------------------------------------------
do $fix$
begin
  if to_regclass('public.document_extractions') is not null then
    drop policy if exists "authenticated_read" on public.document_extractions;
    drop policy if exists document_extractions_scoped_read on public.document_extractions;

    create policy document_extractions_scoped_read
      on public.document_extractions for select
      to authenticated
      using (
        exists (
          select 1
          from public.hackathon_submissions s
          where s.id::text = document_extractions.submission_id
            and (
              s.candidate_id = auth.uid()
              or public.is_hackathon_judge(s.hackathon_id)
            )
        )
      );
  end if;

  if to_regclass('public.judge_evaluations') is not null then
    drop policy if exists judge_evaluations_select on public.judge_evaluations;

    create policy judge_evaluations_select
      on public.judge_evaluations for select
      to authenticated
      using (
        judge_id = auth.uid()
        or exists (
          select 1
          from public.hackathon_submissions s
          where s.id::text = judge_evaluations.submission_id
            and public.is_hackathon_judge(s.hackathon_id)
        )
      );
  end if;
end;
$fix$;

comment on table public.hackathons is
  'One hackathon. `code` is the join/submission code candidates type; `criteria` is its rubric.';
comment on table public.hackathon_submissions is
  'The canonical submission record shared by the candidate and judge portals. Its id is the project id used by analysis, evidence, scoring and rankings.';
