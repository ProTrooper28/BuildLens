-- ---------------------------------------------------------------------------
-- 0010 — candidate-owned analysis progress
--
-- ## The bug this fixes
--
-- The guard trigger from 0007 refuses *every* status change made by a non-judge:
--
--     if not judge_can_write then
--       if new.status is distinct from old.status then
--         raise exception 'Only a judge of this hackathon may change a submission status.';
--
-- The client writes exactly that on the candidate's behalf: `syncSubmissionProgress`
-- runs right after the submission row is inserted (status → 'processing') and again
-- when the analysis finishes (→ 'analyzed'). So on a database with 0007 applied,
-- *every* signed-in submission raised an exception immediately after its row was
-- created — the candidate saw a failed submission, while the project, report and
-- submission rows were already there. The retry then collided with the
-- one-row-per-candidate rules, so "Try again" never recovered.
--
-- ## The rule the trigger meant to express
--
-- A candidate owns the analysis stages of their own submission and nothing else:
--
--   submitted → processing → analyzed        the candidate / analysis pipeline
--   under_review → evaluated → finalized     the judges
--   result_published / published_result      the judges
--
-- So the candidate may move their own row forward through the analysis stages,
-- and may never move it backwards, into a judge-owned state, or publish a result.
-- Everything else is unchanged: hackathon/candidate are still immutable and
-- judges still own review, scoring and publication.
--
-- Idempotent: `create or replace function` swaps the body of the existing trigger.
-- ---------------------------------------------------------------------------

create or replace function public.guard_hackathon_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  judge_can_write boolean := public.is_hackathon_judge(new.hackathon_id);
  -- The two stages the candidate's own pipeline records.
  candidate_stage boolean :=
    new.status in ('processing'::public.submission_status, 'analyzed'::public.submission_status);
  -- Forward-only: a stale tab can never rewind a submission that moved on.
  advanced boolean :=
    array_position(enum_range(null::public.submission_status), new.status)
      > array_position(enum_range(null::public.submission_status), old.status);
begin
  if tg_op = 'UPDATE' then
    if new.hackathon_id is distinct from old.hackathon_id
       or new.candidate_id is distinct from old.candidate_id then
      raise exception 'A submission cannot be moved to another hackathon or candidate.';
    end if;

    if not judge_can_write then
      if new.result_published is distinct from old.result_published
         or new.published_result is distinct from old.published_result
         or new.published_at is distinct from old.published_at then
        raise exception 'Only a judge of this hackathon may publish a result.';
      end if;

      if new.status is distinct from old.status then
        if new.candidate_id is distinct from auth.uid()
           or not candidate_stage
           or not advanced then
          raise exception 'Only a judge of this hackathon may change a submission status.';
        end if;
      end if;
    end if;
  end if;

  new.updated_at = now();
  return new;
end;
$fn$;

-- Make sure the trigger exists and points at the function above (0007 may have
-- been applied only partially).
do $trg$
begin
  if to_regclass('public.hackathon_submissions') is not null then
    if not exists (
      select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'hackathon_submissions'
        and t.tgname = 'hackathon_submissions_guard'
    ) then
      execute $sql$ create trigger hackathon_submissions_guard
        before insert or update on public.hackathon_submissions
        for each row execute function public.guard_hackathon_submission() $sql$;
    end if;
  end if;
end;
$trg$;

comment on function public.guard_hackathon_submission() is
  'Keeps a submission''s hackathon/candidate immutable, lets the candidate advance their own analysis stages, and reserves review, scoring and publication for the hackathon''s judges.';
