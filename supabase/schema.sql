-- Presenter session ownership for Pulse.
-- Run this once in Supabase Dashboard → SQL Editor.
create table if not exists public.presenter_sessions (
  code text primary key check (code ~ '^[0-9]{6}$'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists presenter_sessions_owner_idx
  on public.presenter_sessions(owner_id, created_at desc);

alter table public.presenter_sessions enable row level security;

drop policy if exists "Presenters can read their own sessions" on public.presenter_sessions;
create policy "Presenters can read their own sessions"
  on public.presenter_sessions for select
  using (auth.uid() = owner_id);

drop policy if exists "Presenters can create their own sessions" on public.presenter_sessions;
create policy "Presenters can create their own sessions"
  on public.presenter_sessions for insert
  with check (auth.uid() = owner_id);
