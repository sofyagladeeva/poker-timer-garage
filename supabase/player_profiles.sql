create table if not exists public.player_profiles (
  id                      uuid primary key default gen_random_uuid(),
  telegram_id             bigint unique,
  player_name             text not null,
  username                text,
  phone                   text,
  default_arrival_status  text not null default 'paid',
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on column public.player_profiles.default_arrival_status
  is 'paid | free | promo | freePromo | admin';

alter table public.player_profiles enable row level security;

drop policy if exists "player_profiles_all" on public.player_profiles;
create policy "player_profiles_all" on public.player_profiles
  for all using (true) with check (true);

create index if not exists player_profiles_telegram_id_idx
  on public.player_profiles (telegram_id)
  where telegram_id is not null;

alter publication supabase_realtime add table public.player_profiles;
