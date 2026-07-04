-- Crowd-sourced observation records for already-collected plants.
create table if not exists public.plant_observations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  plant_id uuid not null references public.plants(id) on delete cascade,
  observer_id uuid references auth.users(id) on delete set null,
  observer_label text not null default '访客',
  photo_url text not null,
  capture_lat numeric,
  capture_lng numeric,
  capture_place text,
  note text,
  status text not null default 'pending' check (status in ('pending','approved','rejected'))
);

create index if not exists plant_observations_plant_idx
  on public.plant_observations(plant_id, status);

alter table public.plant_observations enable row level security;

grant select, insert on public.plant_observations to anon;
grant select, insert, update, delete on public.plant_observations to authenticated;
grant all on public.plant_observations to service_role;

drop policy if exists "Observations select" on public.plant_observations;
create policy "Observations select" on public.plant_observations for select
  using (status = 'approved' or private.is_approved_editor(auth.uid()));

drop policy if exists "Observations insert" on public.plant_observations;
create policy "Observations insert" on public.plant_observations for insert
  with check (observer_id is null or observer_id = auth.uid());

drop policy if exists "Observations update" on public.plant_observations;
create policy "Observations update" on public.plant_observations for update to authenticated
  using (private.is_approved_editor(auth.uid()))
  with check (private.is_approved_editor(auth.uid()));

drop policy if exists "Observations delete" on public.plant_observations;
create policy "Observations delete" on public.plant_observations for delete to authenticated
  using (private.is_approved_editor(auth.uid()));
