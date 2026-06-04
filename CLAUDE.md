# Проект: Покер-таймер для клуба Garage — веб-приложение для управления турниром с TV-экраном и админкой

## Архитектура — стек, ключевые директории

**Стек:** React + TypeScript, Vite, Tailwind CSS, Supabase (PostgreSQL + Realtime). Деплой на GitHub Pages через GitHub Actions при каждом пуше в `main`.

**Запуск:**
```bash
npm run dev        # Vite dev server, localhost:5173
npm run build      # tsc -b && vite build → dist/
npm run lint       # ESLint
npm run preview    # превью production-сборки
```

**Два маршрута** (HashRouter — работает на GitHub Pages):
- `/#/` → `Display.tsx` — TV/проектор-экран во время игры
- `/#/admin` → `Admin.tsx` — панель управления (5 вкладок: Управление, Блайнды, Комбо, Архив, Настройки)

**Состояние живёт в Supabase** (если заданы env vars). Без Supabase — fallback на `localStorage`. Единственный источник правды — таблица `game_state` (одна строка, `id = 1`).

**Стратегия синхронизации** (`src/hooks/useGameState.ts`):
- Broadcast channel `poker-broadcast` — мгновенный push (<100ms) для паузы/старта/смены уровня
- `postgres_changes` — персистентная синхронизация при переподключении
- Polling каждые 2с — fallback при обрыве WebSocket (TV-экраны, полноэкранный режим)
- `visibilitychange` — перезапрос при возврате на вкладку
- Skip-флаги (`skipGameStateRealtime`, `skipBlindRealtime`, `skipCombinationsRealtime`) — ставятся на 4с после своей записи, чтобы не обрабатывать эхо собственных событий

**Таймер time-based:** `timeLeft = baseTimeLeft - elapsed`, якорь — `lastTickAt`. Все устройства считают независимо от одного якоря, тикающие сообщения не нужны.

**Ключевые файлы:**

| Файл | Назначение |
|---|---|
| `src/hooks/useGameState.ts` | Вся синхронизация с Supabase, логика таймера, игровые экшны |
| `src/pages/Admin.tsx` | Панель управления |
| `src/pages/Display.tsx` | TV-экран |
| `src/types.ts` | Все типы + `getRankPoints()` + `calcPrizePool()` |
| `src/gameStateMath.ts` | `normalizeGameState()` — приводит сырые данные DB/localStorage к валидному `GameState` |
| `src/gameStateSync.ts` | Логика синхронизации, вынесенная из хука |
| `src/blindStructure.ts` | Пресет `GARAGE_BLIND_PAIRS` + `createGarageBlindTemplate()` |
| `src/blindTemplateLibrary.ts` | CRUD шаблонов блайндов через Supabase (`blind_templates`) |
| `src/backgroundLibrary.ts` | CRUD фонов через Supabase; изображения сжимаются в WebP/JPEG base64, localStorage — только кэш |
| `src/tournamentBotApi.ts` | API-интеграция с Telegram-ботом |
| `src/tournamentBotLiveSync.ts` | Live-синхронизация состояния турнира с ботом |
| `src/tournamentResultsFlow.ts` | Флоу завершения турнира и записи результатов |

**Supabase-таблицы:**

| Таблица | Примечание |
|---|---|
| `game_state` | Одна строка (`id=1`), RLS off |
| `blind_levels` | Строки = текущая структура блайндов, RLS off |
| `combinations` | Обновляется через DELETE-all + INSERT-all |
| `blind_templates` | Сохранённые шаблоны, RLS on, realtime включён |
| `background_library` | Фоны как base64, RLS on |
| `tournaments` | Архив завершённых турниров |

SQL для создания таблиц: `supabase/blind_templates.sql`, `supabase/background_library.sql`, `supabase/bonus_fields.sql`.

**Styling:** Tailwind CSS, тёмная тема. Цвета: фон `#0A0A0A`, карточки `#111`, бордер `#2D2D2D`, акцент красный `#C0392B`/`#E31E24`. Классы кнопок в `index.css`: `admin-btn-primary`, `admin-btn-secondary`, `admin-btn-danger`, `admin-input`.

## Правила — конвенции коммитов, стиля, тестов

- Тестов нет.
- TypeScript-ошибки роняют билд — `tsc -b` запускается до Vite. Перед коммитом убедись, что нет неиспользуемых импортов/переменных (`noUnusedLocals` — strict).
- Деплой автоматический при пуше в `main`. Нужные секреты в GitHub: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ADMIN_PASSWORD`, `VITE_BOT_API_URL`.
- Стиль кода: без комментариев там, где код говорит сам за себя; Tailwind-классы предпочтительнее инлайн-стилей.

## Что НЕ делать — границы, типичные ошибки

- Не использовать upsert для таблицы `combinations` — только DELETE-all + INSERT-all (Supabase не поддерживает удобный bulk upsert для этой таблицы); иначе сломается фокус на мобиле при удалении.
- Не убирать skip-флаги (`skipGameStateRealtime` и др.) — без них устройство будет применять собственные realtime-события и сбрасывать локальное состояние.
- Не делать таймер tick-based (не слать текущее `timeLeft` по сети) — только якорь `lastTickAt`; иначе устройства разъедутся.
- Не добавлять серверный рендеринг и не менять на обычный Router — HashRouter обязателен для GitHub Pages.
- Не хранить большие изображения напрямую в Supabase row без сжатия — фоны сжимаются до WebP/JPEG base64 в `backgroundLibrary.ts`.
