-- lastTickAt хранит unix-timestamp в миллисекундах (~1.78 триллиона),
-- что превышает лимит integer (2.1 млрд). Меняем на bigint.
alter table public.game_state
  alter column "lastTickAt" type bigint;
