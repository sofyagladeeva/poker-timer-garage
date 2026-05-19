# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # dev server (Vite, localhost:5173)
npm run build      # tsc -b && vite build → dist/
npm run lint       # ESLint
npm run preview    # preview production build locally
```

No tests. TypeScript type errors fail the build — `tsc -b` runs before Vite. Always check that unused imports/variables are removed before committing (strict `noUnusedLocals` causes CI failure).

## Deployment

GitHub Actions deploys automatically on every push to `main` via `.github/workflows/deploy.yml` → GitHub Pages. Secrets required: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ADMIN_PASSWORD`, `VITE_BOT_API_URL`.

## Architecture

**Two routes** (HashRouter, so works on GitHub Pages):
- `/#/` → `Display.tsx` — the TV/projector screen shown during the game
- `/#/admin` → `Admin.tsx` — password-protected control panel

**State lives in Supabase** (when env vars are set). Without Supabase everything falls back to `localStorage`. The single source of truth for game state is the `game_state` table (one row, `id = 1`).

### Sync strategy in `useGameState.ts`

- **Broadcast channel** (`poker-broadcast`): instant (<100ms) push for pause/start/level changes — doesn't require the table to be in the realtime publication
- **`postgres_changes`** subscription: persistence sync on reconnect for `game_state` and `blind_levels`
- **Polling every 2s**: fallback for when realtime WebSocket drops (TV screens, fullscreen mode)
- **`visibilitychange`**: re-fetches state when tab becomes visible again
- **Skip flags** (`skipGameStateRealtime`, `skipBlindRealtime`, `skipCombinationsRealtime`): set for 4s after any local write to suppress echo of own realtime events

Timer is **time-based**: `timeLeft` is computed from `baseTimeLeft - elapsed` using `lastTickAt` as an anchor. All devices calculate independently from the same anchor, so they stay in sync without ticking messages.

### Key files

| File | Purpose |
|---|---|
| `src/hooks/useGameState.ts` | All Supabase sync, timer logic, and game actions |
| `src/pages/Admin.tsx` | Control panel — 5 tabs: Управление, Блайнды, Комбо, Архив, Настройки |
| `src/pages/Display.tsx` | Public TV screen |
| `src/types.ts` | All shared types + `getRankPoints()` + `calcPrizePool()` |
| `src/blindStructure.ts` | `GARAGE_BLIND_PAIRS` preset + `createGarageBlindTemplate()` |
| `src/blindTemplateLibrary.ts` | Supabase-backed blind template CRUD (`blind_templates` table) |
| `src/backgroundLibrary.ts` | Supabase-backed background CRUD; images compressed to WebP/JPEG base64, stored in `background_library` table. localStorage is only a cache — quota errors are ignored when Supabase is active |
| `src/gameStateMath.ts` | `normalizeGameState()` — coerces raw DB/localStorage data to valid `GameState` |

### Supabase tables

| Table | Notes |
|---|---|
| `game_state` | Single row (`id=1`), UNRESTRICTED (RLS off) |
| `blind_levels` | Rows = current active blind structure, UNRESTRICTED |
| `combinations` | Updated via DELETE-all + INSERT-all pattern |
| `blind_templates` | Saved templates, RLS on with open policies, realtime enabled |
| `background_library` | Background images as base64 URLs, RLS on |
| `tournaments` | Archive of finished tournaments |

SQL for tables that need setup: `supabase/blind_templates.sql`, `supabase/background_library.sql`, `supabase/bonus_fields.sql`.

### `updateCombinations` pattern

`combinations` uses `DELETE neq('id','') + INSERT` (not upsert) because Supabase doesn't have easy bulk upsert for this table. The `skipCombinationsRealtime` flag prevents the DELETE event from causing an empty-list re-render that would lose input focus on mobile.

## Styling

Tailwind CSS with a dark theme. Color palette: background `#0A0A0A`, cards `#111`, borders `#2D2D2D`, accent red `#C0392B`/`#E31E24`. Button classes defined in `index.css`: `admin-btn-primary`, `admin-btn-secondary`, `admin-btn-danger`, `admin-input`.
