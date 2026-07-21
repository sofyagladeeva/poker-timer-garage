create table if not exists public.player_gifts (
  id                            uuid primary key default gen_random_uuid(),

  -- Кому выдан
  telegram_id                   bigint,
  player_name                   text not null,
  username                      text,

  -- Что за подарок
  type                          text not null,
  comment                       text,

  -- Условие действия
  valid_condition               text not null default 'indefinite',
  valid_tournament_bot_id       bigint,
  valid_tournament_title        text,
  valid_until                   timestamptz,

  -- Статус
  status                        text not null default 'active',

  -- Источник
  source                        text not null default 'manual',
  source_month                  text,

  -- Где и кем выдан
  issued_at_session_id          bigint,
  issued_at_tournament_bot_id   bigint,
  issued_at_tournament_title    text,
  issued_by                     text,
  created_at                    timestamptz not null default now(),

  -- Где и кем списан
  redeemed_at                   timestamptz,
  redeemed_at_session_id        bigint,
  redeemed_at_tournament_bot_id bigint,
  redeemed_at_tournament_title  text,
  redeemed_by                   text,

  -- Уведомления
  notified_at                   timestamptz,
  reminder_sent_at              timestamptz
);

comment on column public.player_gifts.type
  is 'free_entry | free_rebuy | free_addon | custom';
comment on column public.player_gifts.valid_condition
  is 'next_tournament | specific_tournament | until_date | next_month | indefinite';
comment on column public.player_gifts.status
  is 'active | redeemed | cancelled | expired';
comment on column public.player_gifts.source
  is 'manual | auto_winner | auto_monthly_rating | auto_monthly_bounty | auto_monthly_double';
comment on column public.player_gifts.source_month
  is 'YYYY-MM — used for monthly auto-gift deduplication';

alter table public.player_gifts enable row level security;

drop policy if exists "player_gifts_all" on public.player_gifts;
create policy "player_gifts_all" on public.player_gifts
  for all using (true) with check (true);

-- Активные подарки по игроку
create index if not exists player_gifts_active_telegram_idx
  on public.player_gifts (telegram_id, status)
  where telegram_id is not null and status = 'active';

-- Все подарки по игроку (история)
create index if not exists player_gifts_telegram_idx
  on public.player_gifts (telegram_id)
  where telegram_id is not null;

-- Подарки, выданные на конкретном турнире
create index if not exists player_gifts_issued_session_idx
  on public.player_gifts (issued_at_session_id)
  where issued_at_session_id is not null;

-- Подарки, использованные на конкретном турнире
create index if not exists player_gifts_redeemed_session_idx
  on public.player_gifts (redeemed_at_session_id)
  where redeemed_at_session_id is not null;

-- Дедупликация автоподарков победителю
create unique index if not exists player_gifts_winner_dedup_idx
  on public.player_gifts (issued_at_tournament_bot_id, telegram_id)
  where source = 'auto_winner'
    and issued_at_tournament_bot_id is not null
    and telegram_id is not null;

-- Дедупликация ежемесячных автоподарков
create unique index if not exists player_gifts_monthly_dedup_idx
  on public.player_gifts (telegram_id, source, source_month)
  where source in ('auto_monthly_rating', 'auto_monthly_bounty', 'auto_monthly_double')
    and source_month is not null
    and telegram_id is not null;

-- Поиск просроченных подарков
create index if not exists player_gifts_expiry_idx
  on public.player_gifts (valid_until, status)
  where valid_until is not null and status = 'active';
