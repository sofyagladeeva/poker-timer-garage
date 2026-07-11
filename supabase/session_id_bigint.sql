-- session_id хранит unix-timestamp в миллисекундах (~1.78 триллиона),
-- что превышает лимит integer. Меняем на bigint.
alter table public.floor_notifications
  alter column session_id type bigint;
