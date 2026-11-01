-- BuildLens — initial Supabase schema
--
-- Creates the profiles/projects/reports models, row-level-security policies, a
-- trigger that mirrors auth.users into profiles, and the four storage buckets.
--
-- Safe to run multiple times on an idempotent project. When objects already
-- exist it skips or re-applies them without dropping data.
--
-- Apply with the Supabase CLI:   npx supabase db push
-- or paste into the SQL editor and run.

-- ---------------------------------------------------------------------------
-- Enums (only if missing)
-- ---------------------------------------------------------------------------
do $do$
declare
  account_type_exists boolean;
  report_type_exists boolean;
  report_status_exists boolean;
  project_status_exists boolean;
begin
  select exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'account_type'
  ) into account_type_exists;

  select exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'report_type'
  ) into report_type_exists;

  select exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'report_status'
  ) into report_status_exists;

  select exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'project_status'
  ) into project_status_exists;

  if not account_type_exists then
    execute $sql$ create type public.account_type as enum ('Developer', 'Guest', 'Judge') $sql$;
  end if;

  if not report_type_exists then
    execute $sql$ create type public.report_type as enum ('Project', 'Developer') $sql$;
  end if;

  if not report_status_exists then
    execute $sql$ create type public.report_status as enum ('Completed', 'In Progress', 'Failed') $sql$;
  end if;

  if not project_status_exists then
    execute $sql$ create type public.project_status as enum ('draft', 'in_review', 'completed') $sql$;
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- Profiles table (only if it does not already exist)
--
-- If public.profiles already exists in your project with production data, this
-- block is skipped entirely. Do not run this migration against a database that
-- already has a different public.profiles shape unless you have reviewed the
-- column list below against your current schema.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text unique,
  full_name     text,
  avatar_url    text,
  organization  text,
  account_type  public.account_type not null default 'Developer',
  website       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Projects table (only if missing, with RLS enabled inline)
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  name         text not null,
  repo_url     text,
  website_url  text,
  description  text,
  status       public.project_status not null default 'draft',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Reports table (only if missing, with RLS enabled inline)
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  project_id   uuid references public.projects (id) on delete set null,
  type         public.report_type not null,
  name         text not null,
  status       public.report_status not null default 'In Progress',
  score        integer,
  report_data  jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes (only if missing — schema-qualified so IF NOT EXISTS is safe)
-- ---------------------------------------------------------------------------
create index if not exists public.projects_user_id_idx on public.projects (user_id);
create index if not exists public.reports_user_id_idx on public.reports (user_id);
create index if not exists public.reports_project_id_idx on public.reports (project_id);

-- ---------------------------------------------------------------------------
-- updated_at function (only if missing; never replaced)
-- ---------------------------------------------------------------------------
do $do$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_updated_at'
  ) then
    execute $sql$
      create function public.set_updated_at()
      returns trigger
      language plpgsql
      as $$
      begin
        new.updated_at = now();
        return new;
      end;
      $$
    $sql$;
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- updated_at triggers (only if missing)
-- ---------------------------------------------------------------------------
do $do$
begin
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'profiles'
      and t.tgname = 'profiles_set_updated_at'
  ) then
    execute $sql$ create trigger profiles_set_updated_at
      before update on public.profiles
      for each row execute function public.set_updated_at() $sql$;
  end if;
end;
$do$;

do $do$
begin
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'projects'
      and t.tgname = 'projects_set_updated_at'
  ) then
    execute $sql$ create trigger projects_set_updated_at
      before update on public.projects
      for each row execute function public.set_updated_at() $sql$;
  end if;
end;
$do$;

do $do$
begin
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'reports'
      and t.tgname = 'reports_set_updated_at'
  ) then
    execute $sql$ create trigger reports_set_updated_at
      before update on public.reports
      for each row execute function public.set_updated_at() $sql$;
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- Auto-create profile on new auth user (only if missing)
-- ---------------------------------------------------------------------------
do $do$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'handle_new_user'
  ) then
    execute $sql$
      create function public.handle_new_user()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $$
      begin
        insert into public.profiles (id, full_name, username, avatar_url)
        values (
          new.id,
          new.raw_user_meta_data ->> 'full_name',
          nullif(new.raw_user_meta_data ->> 'username', ''),
          new.raw_user_meta_data ->> 'avatar_url'
        )
        on conflict (id) do nothing;
        return new;
      end;
      $$
    $sql$;
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- Auth trigger (only if missing)
--   Checks:  schema = 'auth',  table relname = 'users',  trigger name = 'on_auth_user_created'
-- ---------------------------------------------------------------------------
do $do$
begin
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth'
      and c.relname = 'users'
      and t.tgname = 'on_auth_user_created'
  ) then
    execute $sql$ create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user() $sql$;
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.reports enable row level security;

-- Profiles: readable by everyone, writable only by the owner.
--
-- Idempotent by checking pg_policies: `create policy if not exists` is not valid
-- PostgreSQL (42601), and a migration that aborts here leaves the tables with RLS
-- enabled and *no* policies — which denies every insert, including the candidate
-- submission flow.
create or replace function public.create_policy_if_missing(
  p_schema text,
  p_table text,
  p_name text,
  p_definition text
)
returns void
language plpgsql
as $fn$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = p_schema and tablename = p_table and policyname = p_name
  ) then
    execute p_definition;
  end if;
end;
$fn$;

select public.create_policy_if_missing('public', 'profiles', 'Profiles are viewable by everyone',
  $p$create policy "Profiles are viewable by everyone" on public.profiles for select using (true)$p$);

select public.create_policy_if_missing('public', 'profiles', 'Users can insert their own profile',
  $p$create policy "Users can insert their own profile" on public.profiles for insert with check (auth.uid() = id)$p$);

select public.create_policy_if_missing('public', 'profiles', 'Users can update their own profile',
  $p$create policy "Users can update their own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id)$p$);

-- Projects: owner-only.
select public.create_policy_if_missing('public', 'projects', 'Users can view their own projects',
  $p$create policy "Users can view their own projects" on public.projects for select using (auth.uid() = user_id)$p$);

select public.create_policy_if_missing('public', 'projects', 'Users can create their own projects',
  $p$create policy "Users can create their own projects" on public.projects for insert with check (auth.uid() = user_id)$p$);

select public.create_policy_if_missing('public', 'projects', 'Users can update their own projects',
  $p$create policy "Users can update their own projects" on public.projects for update using (auth.uid() = user_id) with check (auth.uid() = user_id)$p$);

select public.create_policy_if_missing('public', 'projects', 'Users can delete their own projects',
  $p$create policy "Users can delete their own projects" on public.projects for delete using (auth.uid() = user_id)$p$);

-- Reports: owner-only.
select public.create_policy_if_missing('public', 'reports', 'Users can view their own reports',
  $p$create policy "Users can view their own reports" on public.reports for select using (auth.uid() = user_id)$p$);

select public.create_policy_if_missing('public', 'reports', 'Users can create their own reports',
  $p$create policy "Users can create their own reports" on public.reports for insert with check (auth.uid() = user_id)$p$);

select public.create_policy_if_missing('public', 'reports', 'Users can update their own reports',
  $p$create policy "Users can update their own reports" on public.reports for update using (auth.uid() = user_id) with check (auth.uid() = user_id)$p$);

select public.create_policy_if_missing('public', 'reports', 'Users can delete their own reports',
  $p$create policy "Users can delete their own reports" on public.reports for delete using (auth.uid() = user_id)$p$);

-- ---------------------------------------------------------------------------
-- Storage buckets (only if missing)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
select 'avatars', 'avatars', true
where not exists (select 1 from storage.buckets where id = 'avatars');

insert into storage.buckets (id, name, public)
select 'documents', 'documents', false
where not exists (select 1 from storage.buckets where id = 'documents');

insert into storage.buckets (id, name, public)
select 'project-files', 'project-files', false
where not exists (select 1 from storage.buckets where id = 'project-files');

insert into storage.buckets (id, name, public)
select 'demo-videos', 'demo-videos', false
where not exists (select 1 from storage.buckets where id = 'demo-videos');

-- ---------------------------------------------------------------------------
-- Storage bucket policies (only if missing)
-- ---------------------------------------------------------------------------
select public.create_policy_if_missing('storage', 'objects', 'Avatar images are publicly accessible',
  $p$create policy "Avatar images are publicly accessible" on storage.objects for select using (bucket_id = 'avatars')$p$);

select public.create_policy_if_missing('storage', 'objects', 'Users can upload their own avatar',
  $p$create policy "Users can upload their own avatar" on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and owner = auth.uid())$p$);

select public.create_policy_if_missing('storage', 'objects', 'Users can update their own avatar',
  $p$create policy "Users can update their own avatar" on storage.objects for update to authenticated using (bucket_id = 'avatars' and owner = auth.uid())$p$);

select public.create_policy_if_missing('storage', 'objects', 'Users can delete their own avatar',
  $p$create policy "Users can delete their own avatar" on storage.objects for delete to authenticated using (bucket_id = 'avatars' and owner = auth.uid())$p$);

select public.create_policy_if_missing('storage', 'objects', 'Users can manage their own documents',
  $p$create policy "Users can manage their own documents" on storage.objects for all to authenticated using (bucket_id = 'documents' and owner = auth.uid()) with check (bucket_id = 'documents' and owner = auth.uid())$p$);

select public.create_policy_if_missing('storage', 'objects', 'Users can manage their own project files',
  $p$create policy "Users can manage their own project files" on storage.objects for all to authenticated using (bucket_id = 'project-files' and owner = auth.uid()) with check (bucket_id = 'project-files' and owner = auth.uid())$p$);

select public.create_policy_if_missing('storage', 'objects', 'Users can manage their own demo videos',
  $p$create policy "Users can manage their own demo videos" on storage.objects for all to authenticated using (bucket_id = 'demo-videos' and owner = auth.uid()) with check (bucket_id = 'demo-videos' and owner = auth.uid())$p$);
