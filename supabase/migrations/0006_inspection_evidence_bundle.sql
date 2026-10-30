-- Evidence bundle on evaluation runs.
--
-- The evaluation pipeline collects evidence (repository, deployed site, deck)
-- before it calls the model. Persisting that bundle on the run lets the judge
-- inspect what was verified even when the model stage fails or no model key is
-- configured. Additive only: existing rows keep a null bundle and existing
-- columns are untouched.

alter table if exists public.ai_evaluation_runs
  add column if not exists evidence_bundle jsonb;

comment on column public.ai_evaluation_runs.evidence_bundle is
  'Deterministic evidence collected for the run (sources, observations, claim statuses). Written before the model call so it survives a failed model stage.';
