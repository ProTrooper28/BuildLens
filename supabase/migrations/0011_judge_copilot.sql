-- BuildLens — judge copilot: questions and structured review
--
-- Additive only. `judge_evaluations` already carries one row per
-- (submission, judge) with RLS, so the copilot state lives beside the score
-- instead of in a second table that could drift out of sync:
--
--   questions  the generated + judge-written questions and their state
--              (pending / asked / answered), stored as an array of objects
--   review     the mentor's structured review: assessment, strengths,
--              weaknesses, suggestions, concerns and final recommendation
--
-- Both are jsonb so the shape can grow without another migration, and the
-- questions default to an empty array so existing rows stay valid.

alter table if exists public.judge_evaluations
  add column if not exists questions jsonb not null default '[]'::jsonb;

alter table if exists public.judge_evaluations
  add column if not exists review jsonb;

comment on column public.judge_evaluations.questions is
  'Questions for the team (evidence-generated and judge-written) with status: pending, asked or answered.';

comment on column public.judge_evaluations.review is
  'The mentor''s structured review: overall assessment, strengths, weaknesses, suggestions, concerns and final recommendation.';

-- Keep the newest copilot state readable without a second round trip.
create index if not exists judge_evaluations_questions_idx
  on public.judge_evaluations using gin (questions jsonb_path_ops);
