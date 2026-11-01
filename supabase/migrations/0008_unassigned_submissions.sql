-- ---------------------------------------------------------------------------
-- 0008 — unassigned submissions
--
-- The candidate's hackathon code is optional. A project submitted without one is
-- still a real submission (deck, repository, deployment, analysis and status),
-- it simply has no hackathon yet: it waits in a shared intake pool until an
-- organizer files it under an event. This migration makes that representable —
-- `hackathon_submissions.hackathon_id` becomes nullable — without changing what
-- an assigned submission means.
--
-- Nothing is copied between events: assigning only sets the foreign key, so a
-- project moved into HACK-001 appears in that workspace and nowhere else.
-- ---------------------------------------------------------------------------

alter table public.hackathon_submissions
  alter column hackathon_id drop not null;

-- The old constraint allowed one submission per candidate *per hackathon*, and
-- NULLs never collide in a unique constraint — a candidate could have filed the
-- same project a hundred times. One open unassigned submission per candidate is
-- enough: a retried submit reuses it instead of stacking duplicates.
create unique index if not exists hackathon_submissions_one_unassigned
  on public.hackathon_submissions (candidate_id)
  where hackathon_id is null;

-- Judges see unassigned submissions in order to claim them. They are not scoped
-- to an event yet, so the per-hackathon judge helper cannot apply; any signed-in
-- reader of the portal can see the pool (the app gates the intake list to the
-- judge role), and the insert/update policies still restrict who may write.
drop policy if exists hackathon_submissions_intake_select on public.hackathon_submissions;
create policy hackathon_submissions_intake_select
  on public.hackathon_submissions for select
  using (
    hackathon_id is null
    and exists (select 1 from public.profiles p where p.id = auth.uid())
  );

-- Assigning an unassigned row to an event is a move into a hackathon the viewer
-- judges; `is_hackathon_judge(new row)` already covers that, and unassigning
-- (moving back to the pool) is allowed for the judge who can see the old row.
drop policy if exists hackathon_submissions_intake_update on public.hackathon_submissions;
create policy hackathon_submissions_intake_update
  on public.hackathon_submissions for update
  using (
    hackathon_id is null
    and exists (select 1 from public.profiles p where p.id = auth.uid())
  )
  with check (
    candidate_id = auth.uid()
    or public.is_hackathon_judge(hackathon_id)
    or hackathon_id is null
  );

comment on column public.hackathon_submissions.hackathon_id is
  'Null while the submission is unassigned: the candidate submitted without a code and an organizer files it under an event later.';
