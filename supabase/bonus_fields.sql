alter table public.game_state
add column if not exists "bonusCount" integer not null default 0;

alter table public.game_state
add column if not exists "bonusStack" integer not null default 0;

alter table public.tournaments
add column if not exists bonus_count integer not null default 0;

alter table public.tournaments
add column if not exists bonus_stack integer not null default 0;
