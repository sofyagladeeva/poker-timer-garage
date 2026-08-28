alter table public.player_gifts
  add column if not exists multi_use boolean not null default false;

comment on column public.player_gifts.multi_use
  is 'true = многоразовый (победитель месяца — вход/ребай/аддон на каждую игру до конца срока)';
