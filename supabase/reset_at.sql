-- Добавляет поле resetAt в game_state для защиты от устаревших вкладок.
-- resetAt меняется только при resetTournament() — используется как маркер
-- "поколения" турнира. Устаревшие устройства со старым resetAt не могут
-- перезаписать текущую игру в базе.
alter table public.game_state
  add column if not exists "resetAt" bigint not null default 0;
