import React, { useState, useEffect, useRef, Component } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { useGameState } from '../hooks/useGameState';
import { supabase } from '../supabase';
import { getNextGarageBlindPair } from '../blindStructure';
import { calcTotalStack } from '../gameStateMath';
import type { BlindLevel, BlindTemplate, Combination, Card, Suit, Rank, TournamentRecord, GameState } from '../types';
import { SUIT_SYMBOLS } from '../types';
import { PokerCard } from '../components/PokerCard';
import {
  buildBlindTemplate,
  deleteSharedBlindTemplates,
  fetchSharedBlindTemplates,
  isSharedBlindTemplateLibraryEnabled,
  loadBlindTemplates,
  mergeBlindTemplates,
  PRESET_BLIND_TEMPLATES,
  saveBlindTemplates,
  upsertSharedBlindTemplate,
} from '../blindTemplateLibrary';
import {
  createBackgroundFromFile,
  deleteSharedBackgrounds,
  fetchSharedBackgroundLibrary,
  isSharedBackgroundLibraryEnabled,
  loadBackgroundLibrary,
  mergeBackgroundLibraries,
  PRESET_BACKGROUNDS,
  saveBackgroundLibrary,
  upsertSharedBackgrounds,
} from '../backgroundLibrary';
import type { StoredBackground } from '../backgroundLibrary';

// ─── Error Boundary ────────────────────────────────────────────────────────
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message + '\n' + err.stack : String(err) };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center px-4">
          <div className="bg-red-950 border border-red-700 rounded-2xl p-6 w-full max-w-lg">
            <div className="text-red-400 font-bold text-lg mb-3">Ошибка рендера</div>
            <pre className="text-red-300 text-xs whitespace-pre-wrap break-all">{this.state.error}</pre>
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-4 admin-btn-primary px-4 py-2 text-sm"
            >Попробовать снова</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const BOT_API = import.meta.env.VITE_BOT_API_URL || 'https://web-production-6035.up.railway.app';

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || 'poker2024';
const MAX_BACKGROUND_ITEMS = 24;

// ─── Card picker ──────────────────────────────────────────────────────────
const RANKS: Rank[] = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];
const SUITS: Suit[] = ['spades','hearts','diamonds','clubs','any'];

function CardPicker({ onAdd }: { onAdd: (card: Card) => void }) {
  const [rank, setRank] = useState<Rank>('A');
  const [suit, setSuit] = useState<Suit>('spades');

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={rank}
        onChange={e => setRank(e.target.value as Rank)}
        className="admin-input w-16"
      >
        {RANKS.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      <select
        value={suit}
        onChange={e => setSuit(e.target.value as Suit)}
        className="admin-input w-28"
      >
        {SUITS.map(s => (
          <option key={s} value={s}>
            {s === 'any' ? '♠♥♦♣ любая масть' : `${SUIT_SYMBOLS[s]} ${s}`}
          </option>
        ))}
      </select>
      <button
        onClick={() => onAdd({ rank, suit })}
        className="admin-btn-primary px-3 py-2 text-sm"
      >
        + Добавить карту
      </button>
    </div>
  );
}

// ─── Blind level row ──────────────────────────────────────────────────────
function BlindRow({
  level,
  onChange,
  onDelete,
}: {
  level: BlindLevel;
  onChange: (l: BlindLevel) => void;
  onDelete: () => void;
}) {
  const upd = (patch: Partial<BlindLevel>) => onChange({ ...level, ...patch });
  const [sbDraft, setSbDraft] = useState(String(level.sb));
  const [bbDraft, setBbDraft] = useState(String(level.bb));
  const [minutesDraft, setMinutesDraft] = useState(String(Math.round(level.duration / 60)));

  useEffect(() => {
    setMinutesDraft(String(Math.round(level.duration / 60)));

    if (!level.isBreak) {
      setSbDraft(String(level.sb));
      setBbDraft(String(level.bb));
    }
  }, [level.id, level.isBreak, level.sb, level.bb, level.duration]);

  const parseDraftNumber = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === '') return null;

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return null;

    return Math.max(0, Math.round(parsed));
  };

  const commitMinutes = () => {
    const nextMinutes = parseDraftNumber(minutesDraft);
    if (nextMinutes === null) {
      setMinutesDraft(String(Math.round(level.duration / 60)));
      return;
    }

    const normalizedMinutes = Math.max(1, nextMinutes);
    setMinutesDraft(String(normalizedMinutes));
    upd({ duration: normalizedMinutes * 60 });
  };

  if (level.isBreak) {
    return (
      <div className="bg-blue-900/20 border border-blue-700/30 rounded-xl p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-blue-400 text-xs font-bold uppercase tracking-wider">Перерыв</span>
          <button onClick={onDelete} className="admin-btn-danger px-3 py-2 text-sm">✕</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input className="admin-input" placeholder="Название" value={level.breakLabel || ''}
            onChange={e => upd({ breakLabel: e.target.value })} />
          <div className="flex items-center gap-1">
            <input
              type="text"
              inputMode="numeric"
              className="admin-input"
              placeholder="мин"
              value={minutesDraft}
              onChange={e => setMinutesDraft(e.target.value)}
              onBlur={commitMinutes}
              onKeyDown={e => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            />
            <span className="text-[#555] text-xs flex-shrink-0">мин</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#111] border border-[#2D2D2D] rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[#666] text-xs">Ур. {level.level}</span>
        <button onClick={onDelete} className="admin-btn-danger px-3 py-2 text-sm">✕</button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <div className="text-[#555] text-[10px] uppercase tracking-wider mb-1">SB</div>
          <input
            type="text"
            inputMode="numeric"
            className="admin-input text-sm px-2"
            value={sbDraft}
            onChange={e => setSbDraft(e.target.value)}
            onBlur={() => {
              const nextSb = parseDraftNumber(sbDraft);
              if (nextSb === null) {
                setSbDraft(String(level.sb));
                return;
              }

              setSbDraft(String(nextSb));
              upd({ sb: nextSb });
            }}
            onKeyDown={e => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
        </div>
        <div>
          <div className="text-[#555] text-[10px] uppercase tracking-wider mb-1">BB</div>
          <input
            type="text"
            inputMode="numeric"
            className="admin-input text-sm px-2"
            value={bbDraft}
            onChange={e => setBbDraft(e.target.value)}
            onBlur={() => {
              const nextBb = parseDraftNumber(bbDraft);
              if (nextBb === null) {
                setBbDraft(String(level.bb));
                return;
              }

              setBbDraft(String(nextBb));
              upd({ bb: nextBb, ante: level.ante > 0 ? nextBb : 0 });
            }}
            onKeyDown={e => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
        </div>
        <div>
          <div className="text-[#555] text-[10px] uppercase tracking-wider mb-1">Мин</div>
          <input
            type="text"
            inputMode="numeric"
            className="admin-input text-sm px-2"
            value={minutesDraft}
            onChange={e => setMinutesDraft(e.target.value)}
            onBlur={commitMinutes}
            onKeyDown={e => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main Admin page ───────────────────────────────────────────────────────
export function Admin() {
  const sharedBackgroundLibraryEnabled = isSharedBackgroundLibraryEnabled();
  const sharedBlindTemplateLibraryEnabled = isSharedBlindTemplateLibraryEnabled();
  const [authed, setAuthed] = useState(false);
  const [pwInput, setPwInput] = useState('');
  const [pwError, setPwError] = useState(false);
  const [activeTab, setActiveTab] = useState<'control' | 'blinds' | 'combos' | 'archive' | 'settings'>('control');
  const [gamePickerOpen, setGamePickerOpen] = useState(false);
  const [customGameOpen, setCustomGameOpen] = useState(false);
  const [customGameTitle, setCustomGameTitle] = useState('');
  const [nextGamePickerOpen, setNextGamePickerOpen] = useState(false);
  const [blindTemplates, setBlindTemplates] = useState<BlindTemplate[]>(() => loadBlindTemplates());
  const [templateName, setTemplateName] = useState('');
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateNote, setTemplateNote] = useState<string | null>(null);
  const [backgroundLibrary, setBackgroundLibrary] = useState<StoredBackground[]>(() => loadBackgroundLibrary());
  const [backgroundUploadBusy, setBackgroundUploadBusy] = useState(false);
  const [backgroundUploadError, setBackgroundUploadError] = useState<string | null>(null);
  const [backgroundUploadNote, setBackgroundUploadNote] = useState<string | null>(null);
  // ── Drag state for blind levels ────────────────────────────────────────
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropLine, setDropLine] = useState<number | null>(null);
  const rowEls = useRef<(HTMLDivElement | null)[]>([]);
  const dragging = useRef(false);
  const blindTemplatesRef = useRef(blindTemplates);
  const backgroundLibraryRef = useRef(backgroundLibrary);

  const {
    gameState, blindLevels, combinations,
    updateGameState, startTimer, pauseTimer, nextLevel, prevLevel, resetTournament,
    updateBlindLevels, updateCombinations, saveTournament, fetchTournaments, deleteTournament,
  } = useGameState();
  const gameStateSnapshotRef = useRef(gameState);

  const [tournaments, setTournaments] = useState<TournamentRecord[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // ── Bot games list ─────────────────────────────────────────────────────
  const [botGames, setBotGames] = useState<{ id: number; title: string; date: string; confirmed: number; max_players: number }[]>([]);
  useEffect(() => {
    fetch(`${BOT_API}/api/games`)
      .then(r => r.json())
      .then(setBotGames)
      .catch(() => {});
  }, []);

  useEffect(() => {
    blindTemplatesRef.current = blindTemplates;
  }, [blindTemplates]);

  useEffect(() => {
    gameStateSnapshotRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    backgroundLibraryRef.current = backgroundLibrary;
  }, [backgroundLibrary]);

  // ── Пробел = play/pause ────────────────────────────────────────────────
  useEffect(() => {
    if (!authed) return;
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT') {
        e.preventDefault();
        const running = gameState.status === 'running' || gameState.status === 'break';
        if (running) pauseTimer(); else startTimer();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [authed, gameState.status, startTimer, pauseTimer]);

  // ── Auth ──────────────────────────────────────────────────────────────
  const handleLogin = () => {
    if (pwInput === ADMIN_PASSWORD) {
      setAuthed(true);
      sessionStorage.setItem('admin_authed', '1');
    } else {
      setPwError(true);
      setTimeout(() => setPwError(false), 2000);
    }
  };

  useEffect(() => {
    if (sessionStorage.getItem('admin_authed') === '1') setAuthed(true);
  }, []);

  // ── Load archive when tab opens — MUST be before any early return ──────
  useEffect(() => {
    if (activeTab !== 'archive') return;
    setArchiveLoading(true);
    fetchTournaments().then(data => {
      setTournaments(data);
      setArchiveLoading(false);
    });
  }, [activeTab, fetchTournaments]);

  const syncBlindTemplateState = (next: BlindTemplate[]) => {
    const result = saveBlindTemplates(next);
    if (!result.ok) {
      return result;
    }

    setBlindTemplates(next);
    return { ok: true as const };
  };

  useEffect(() => {
    if (activeTab !== 'blinds') return;

    let cancelled = false;

    const loadTemplateLibrary = async () => {
      setTemplateError(null);

      try {
        if (!sharedBlindTemplateLibraryEnabled) {
          if (!cancelled) {
            const localTemplates = loadBlindTemplates().filter(template => !template.id.startsWith('preset_'));
            const cacheResult = syncBlindTemplateState(localTemplates);
            if (!cacheResult.ok) setTemplateError(cacheResult.error);
          }
          return;
        }

        const remote = await fetchSharedBlindTemplates();
        const local = loadBlindTemplates();
        const mergedCustom = mergeBlindTemplates(remote, local).filter(template => !template.id.startsWith('preset_'));

        if (!cancelled) {
          const cacheResult = syncBlindTemplateState(mergedCustom);
          if (!cacheResult.ok) {
            setTemplateError(cacheResult.error);
          }
        }
      } catch (err) {
        if (!cancelled) {
          const fallbackTemplates = loadBlindTemplates().filter(template => !template.id.startsWith('preset_'));
          const cacheResult = syncBlindTemplateState(fallbackTemplates);
          if (!cacheResult.ok) {
            setTemplateError(cacheResult.error);
            return;
          }

          const baseError = err instanceof Error ? err.message : 'Не удалось загрузить шаблоны блайндов';
          setTemplateError(`${baseError} Шаблоны доступны локально только на этом устройстве.`);
        }
      }
    };

    loadTemplateLibrary();

    return () => {
      cancelled = true;
    };
  }, [activeTab, sharedBlindTemplateLibraryEnabled]);

  // ── Realtime sync: шаблоны обновляются на всех устройствах сразу ──────────
  useEffect(() => {
    if (!sharedBlindTemplateLibraryEnabled) return;

    const channel = supabase
      .channel('blind-templates-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blind_templates' }, async () => {
        try {
          const remote = await fetchSharedBlindTemplates();
          const local = loadBlindTemplates();
          const merged = mergeBlindTemplates(remote, local).filter(t => !t.id.startsWith('preset_'));
          saveBlindTemplates(merged);
          setBlindTemplates(merged);
        } catch {
          // не блокируем UI при ошибке realtime
        }
      })
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [sharedBlindTemplateLibraryEnabled]);

  const persistBlindTemplates = async (next: BlindTemplate[], templateToSave?: BlindTemplate) => {
    const customTemplates = next.filter(template => !template.id.startsWith('preset_'));

    if (templateToSave) {
      const saveResult = await upsertSharedBlindTemplate(templateToSave);
      if (!saveResult.ok) {
        const cacheResult = syncBlindTemplateState(customTemplates);
        if (!cacheResult.ok) {
          setTemplateError(cacheResult.error);
          return false;
        }

        setTemplateError(`${saveResult.error} Шаблон сохранен локально только на этом устройстве.`);
        return true;
      }
    }

    const cacheResult = syncBlindTemplateState(customTemplates);
    if (!cacheResult.ok) {
      setTemplateError(cacheResult.error);
      return false;
    }

    return true;
  };

  const syncBackgroundLibraryState = (next: StoredBackground[]) => {
    const result = saveBackgroundLibrary(next);
    // Если Supabase настроен — localStorage лишь кеш, его переполнение не критично
    if (!result.ok && !sharedBackgroundLibraryEnabled) {
      return result;
    }

    setBackgroundLibrary(next);
    return { ok: true as const };
  };

  useEffect(() => {
    if (activeTab !== 'settings' || !sharedBackgroundLibraryEnabled) return;

    let cancelled = false;

    const loadSharedLibrary = async () => {
      setBackgroundUploadError(null);

      try {
        const remote = await fetchSharedBackgroundLibrary();
        const local = loadBackgroundLibrary();
        const missingLocal = local.filter(item =>
          !remote.some(remoteItem => remoteItem.url === item.url)
        );
        const merged = mergeBackgroundLibraries(remote, local).slice(0, MAX_BACKGROUND_ITEMS);
        const trimmedCount = remote.length + missingLocal.length - merged.length;
        const acceptedMissingLocal = missingLocal.filter(item =>
          merged.some(mergedItem => mergedItem.id === item.id)
        );

        if (acceptedMissingLocal.length > 0) {
          const uploadResult = await upsertSharedBackgrounds(acceptedMissingLocal);
          if (!uploadResult.ok) throw new Error(uploadResult.error);
        }

        if (!cancelled) {
          const cacheResult = syncBackgroundLibraryState(merged);
          if (!cacheResult.ok) {
            setBackgroundUploadError(cacheResult.error);
          } else if (acceptedMissingLocal.length > 0) {
            const noteParts = [`Синхронизировано локальных фонов: ${acceptedMissingLocal.length}.`];
            if (trimmedCount > 0) {
              noteParts.push(`Лишние ${trimmedCount} шт. не вошли в общий лимит ${MAX_BACKGROUND_ITEMS}.`);
            }
            setBackgroundUploadNote(noteParts.join(' '));
          }
        }
      } catch (err) {
        if (!cancelled) {
          setBackgroundUploadError(
            err instanceof Error ? err.message : 'Не удалось загрузить общую библиотеку фонов'
          );
        }
      }
    };

    loadSharedLibrary();

    return () => {
      cancelled = true;
    };
  }, [activeTab, sharedBackgroundLibraryEnabled]);

  const persistBackgroundLibrary = async (next: StoredBackground[], removedIds: string[] = []) => {
    if (!sharedBackgroundLibraryEnabled) {
      const cacheResult = syncBackgroundLibraryState(next);
      if (!cacheResult.ok) {
        setBackgroundUploadError(cacheResult.error);
        return false;
      }
      return true;
    }

    const current = backgroundLibraryRef.current;
    const toAdd = next.filter(item => !current.some(existing => existing.id === item.id));

    if (toAdd.length > 0) {
      const addResult = await upsertSharedBackgrounds(toAdd);
      if (!addResult.ok) {
        setBackgroundUploadError(addResult.error);
        return false;
      }
    }

    if (removedIds.length > 0) {
      const deleteResult = await deleteSharedBackgrounds(removedIds);
      if (!deleteResult.ok) {
        setBackgroundUploadError(deleteResult.error);
        return false;
      }
    }

    const cacheResult = syncBackgroundLibraryState(next);
    if (!cacheResult.ok) {
      setBackgroundUploadError(cacheResult.error);
      return false;
    }

    return true;
  };

  const handleBackgroundUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setBackgroundUploadBusy(true);
    setBackgroundUploadError(null);
    setBackgroundUploadNote(null);

    try {
      const uploaded = await Promise.all(files.map(createBackgroundFromFile));
      const current = backgroundLibraryRef.current;
      const dedupedCurrent = current.filter(existing =>
        !uploaded.some(item => item.url === existing.url)
      );
      const merged = [...uploaded, ...dedupedCurrent].slice(0, MAX_BACKGROUND_ITEMS);
      const removedFromLibrary = current.filter(existing =>
        !merged.some(item => item.id === existing.id)
      );
      const trimmedCount = uploaded.length + dedupedCurrent.length - merged.length;

      if (await persistBackgroundLibrary(merged, removedFromLibrary.map(item => item.id))) {
        const parts = [`Загружено фонов: ${uploaded.length}.`];
        if (trimmedCount > 0) {
          parts.push(`Лишние ${trimmedCount} шт. не сохранены, лимит: ${MAX_BACKGROUND_ITEMS}.`);
        }
        if (sharedBackgroundLibraryEnabled) {
          parts.push('Библиотека синхронизирована для всех устройств.');
        }
        setBackgroundUploadNote(parts.join(' '));
      }
    } catch (err) {
      setBackgroundUploadError(err instanceof Error ? err.message : 'Не удалось загрузить изображения');
    } finally {
      setBackgroundUploadBusy(false);
      e.target.value = '';
    }
  };

  const removeBackground = async (backgroundId: string) => {
    setBackgroundUploadError(null);
    setBackgroundUploadNote(null);

    const current = backgroundLibraryRef.current;
    const toRemove = current.find(item => item.id === backgroundId);
    const next = current.filter(item => item.id !== backgroundId);

    if (!(await persistBackgroundLibrary(next, [backgroundId]))) return;

    if (toRemove && gameState.backgroundUrl === toRemove.url) {
      updateGameState({ backgroundUrl: null });
    }
  };

  const saveCurrentBlindTemplate = async () => {
    const name = templateName.trim();
    if (!name) {
      setTemplateError('Введите название шаблона');
      setTemplateNote(null);
      return;
    }

    setTemplateBusy(true);
    setTemplateError(null);
    setTemplateNote(null);

    try {
      const existing = blindTemplatesRef.current.find(
        template => template.name.trim().toLowerCase() === name.toLowerCase()
      );
      const template = buildBlindTemplate(name, blindLevels, existing?.id);
      const next = mergeBlindTemplates(
        blindTemplatesRef.current.filter(item => item.id !== template.id),
        [template]
      );

      if (await persistBlindTemplates(next, template)) {
        setTemplateName('');
        setTemplateNote(existing ? `Шаблон «${name}» обновлен.` : `Шаблон «${name}» сохранен.`);
      }
    } finally {
      setTemplateBusy(false);
    }
  };

  const applyBlindTemplate = async (template: BlindTemplate) => {
    setTemplateError(null);
    setTemplateNote(null);

    const levels = template.levels.map(level => ({ ...level }));
    await updateBlindLevels(levels);

    const firstLevel = levels[0];
    await updateGameState({
      currentLevelIndex: 0,
      timeLeft: firstLevel?.duration ?? 1200,
      status: 'paused',
    });

    setTemplateNote(`Применен шаблон «${template.name}».`);
  };

  const removeBlindTemplate = async (templateId: string) => {
    setTemplateError(null);
    setTemplateNote(null);

    const next = blindTemplatesRef.current.filter(template => template.id !== templateId);
    const deleteResult = await deleteSharedBlindTemplates([templateId]);
    if (!deleteResult.ok) {
      const cacheResult = syncBlindTemplateState(next);
      if (!cacheResult.ok) {
        setTemplateError(cacheResult.error);
        return;
      }

      setTemplateError(`${deleteResult.error} Шаблон удален локально только на этом устройстве.`);
      return;
    }

    const cacheResult = syncBlindTemplateState(next);
    if (!cacheResult.ok) {
      setTemplateError(cacheResult.error);
      return;
    }

    setTemplateNote('Шаблон удален.');
  };

  const allBlindTemplates = mergeBlindTemplates(PRESET_BLIND_TEMPLATES, blindTemplates);
  const allBackgrounds = [...PRESET_BACKGROUNDS, ...backgroundLibrary];

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center px-4">
        <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-8 w-full max-w-sm">
          <div className="text-[#C0392B] text-2xl font-bold text-center mb-6">🃏 POKER TIMER</div>
          <div className="text-[#888] text-sm mb-4 text-center">Введите пароль администратора</div>
          <input
            type="password"
            className="admin-input mb-3"
            placeholder="Пароль"
            value={pwInput}
            onChange={e => setPwInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            autoFocus
          />
          {pwError && <div className="text-red-500 text-sm text-center mb-2">Неверный пароль</div>}
          <button onClick={handleLogin} className="admin-btn-primary w-full py-3">Войти</button>
        </div>
      </div>
    );
  }

  // ── Timer status helpers ───────────────────────────────────────────────
  const isRunning = gameState.status === 'running' || gameState.status === 'break';
  const minutes = Math.floor(gameState.timeLeft / 60);
  const seconds = gameState.timeLeft % 60;

  const currentLevel = blindLevels[gameState.currentLevelIndex];
  const regularBlindLevels = blindLevels.filter(level => !level.isBreak);
  const anteStartLevel = regularBlindLevels.find(level => level.ante > 0)?.level ?? 0;

  const updateStackState = (
    patch: Partial<Pick<GameState, 'players' | 'rebuys' | 'addonCount' | 'bonusCount' | 'startStack' | 'addonStack' | 'bonusStack'>>
  ) => {
    const nextState = { ...gameStateSnapshotRef.current, ...patch };
    updateGameState({ ...patch, totalStack: calcTotalStack(nextState) });
  };

  const applyAnteStartLevel = (startLevel: number) => {
    updateBlindLevels(
      blindLevels.map(level => {
        if (level.isBreak) {
          return { ...level, ante: 0 };
        }

        return {
          ...level,
          ante: startLevel > 0 && level.level >= startLevel ? level.bb : 0,
        };
      })
    );
  };

  // ── Demo data ──────────────────────────────────────────────────────────
  // ── Blind levels editor ────────────────────────────────────────────────
  const addBlindLevel = () => {
    const nextPair = getNextGarageBlindPair(blindLevels);
    const lastRegularLevel = regularBlindLevels[regularBlindLevels.length - 1];
    const newLevel: BlindLevel = {
      id: Date.now().toString(),
      level: regularBlindLevels.length + 1,
      sb: nextPair.sb,
      bb: nextPair.bb,
      ante: lastRegularLevel?.ante > 0 ? nextPair.bb : 0,
      duration: 1200,
      isBreak: false,
    };
    updateBlindLevels([...blindLevels, newLevel]);
  };

  const addBreak = () => {
    const breakLevel: BlindLevel = {
      id: Date.now().toString(),
      level: 0,
      sb: 0, bb: 0, ante: 0,
      duration: 900,
      isBreak: true,
      breakLabel: 'ПЕРЕРЫВ',
    };
    updateBlindLevels([...blindLevels, breakLevel]);
  };

  const updateLevel = (idx: number, level: BlindLevel) => {
    const updated = [...blindLevels];
    updated[idx] = level;
    updateBlindLevels(updated);
  };

  const deleteLevel = (idx: number) => {
    updateBlindLevels(blindLevels.filter((_, i) => i !== idx));
  };

  const moveLevel = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= blindLevels.length) return;
    const updated = [...blindLevels];
    [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
    updateBlindLevels(updated);
  };

  const getDropLine = (y: number): number => {
    for (let i = 0; i < rowEls.current.length; i++) {
      const el = rowEls.current[i];
      if (!el) continue;
      const { top, height } = el.getBoundingClientRect();
      if (y < top + height / 2) return i;
    }
    return rowEls.current.length;
  };

  const commitDrop = () => {
    if (dragging.current && dragIdx !== null && dropLine !== null) {
      const from = dragIdx;
      const to = dropLine > from ? dropLine - 1 : dropLine;
      if (from !== to) {
        const arr = [...blindLevels];
        const [item] = arr.splice(from, 1);
        arr.splice(to, 0, item);
        updateBlindLevels(arr);
      }
    }
    dragging.current = false;
    setDragIdx(null);
    setDropLine(null);
  };

  // ── Combinations editor ────────────────────────────────────────────────
  const addCombo = () => {
    const newCombo: Combination = {
      id: Date.now().toString(),
      cards: [],
      description: '',
      enabled: true,
    };
    updateCombinations([newCombo, ...combinations]);
  };

  const updateCombo = (idx: number, combo: Combination) => {
    const updated = [...combinations];
    updated[idx] = combo;
    updateCombinations(updated);
  };

  const deleteCombo = (idx: number) => {
    updateCombinations(combinations.filter((_, i) => i !== idx));
  };

  const addCardToCombo = (comboIdx: number, card: Card) => {
    const combo = combinations[comboIdx];
    updateCombo(comboIdx, { ...combo, cards: [...combo.cards, card] });
  };

  const removeCardFromCombo = (comboIdx: number, cardIdx: number) => {
    const combo = combinations[comboIdx];
    updateCombo(comboIdx, {
      ...combo,
      cards: combo.cards.filter((_, i) => i !== cardIdx),
    });
  };

  // ── Tabs ──────────────────────────────────────────────────────────────
  const tabs = [
    { id: 'control', label: '▶ Управление' },
    { id: 'blinds',  label: '💰 Блайнды' },
    { id: 'combos',  label: '🃏 Комбо' },
    { id: 'archive', label: '📋 Архив' },
    { id: 'settings',label: '⚙️ Настройки' },
  ] as const;
  // GitHub Pages may serve the custom domain over HTTP before the TLS
  // certificate is issued, so force the display link to stay on HTTP there.
  const displayOrigin = window.location.hostname === 'gg1409.ru' && window.location.protocol === 'https:'
    ? 'http://gg1409.ru'
    : window.location.origin;
  const displayHref = `${displayOrigin}${import.meta.env.BASE_URL}#/`;

  return (
    <ErrorBoundary>
    <div className="min-h-screen bg-[#0A0A0A] text-white">

      {/* Header */}
      <div className="bg-[#111] border-b border-[#2D2D2D] px-3 sm:px-6 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-[#C0392B] font-bold text-base sm:text-lg whitespace-nowrap">🃏 ADMIN</div>
          {gameState.tournamentTitle && (
            <span className="text-[#555] text-xs sm:text-sm font-medium uppercase tracking-wide truncate">
              · {gameState.tournamentTitle}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a
            href={displayHref}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-[#C0392B] text-white text-xs font-bold rounded-lg px-2 py-1.5 hover:bg-[#E31E24] transition-colors whitespace-nowrap"
          >
            ↗ Табло
          </a>
        </div>
      </div>

      {/* Tabs — scrollable on mobile */}
      <div className="flex gap-1 px-3 pt-3 border-b border-[#2D2D2D] overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-xs sm:text-sm rounded-t-lg transition-colors whitespace-nowrap flex-shrink-0 ${
              activeTab === tab.id
                ? 'bg-[#1A1A1A] text-white border border-b-0 border-[#2D2D2D]'
                : 'text-[#666] hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-3 sm:p-6 max-w-4xl">

        {/* ─── CONTROL TAB ─────────────────────────────────────────────── */}
        {activeTab === 'control' && (
          <div className="flex flex-col gap-4">

            {/* ── Выбор / создание игры ──────────────────────────────── */}
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              {/* Заголовок с текущим выбором */}
              <button
                onClick={() => { setGamePickerOpen(o => !o); setCustomGameOpen(false); }}
                className="flex items-center justify-between w-full"
              >
                <div className="text-sm">
                  {gameState.tournamentTitle
                    ? <span className="text-white font-bold">✓ {gameState.tournamentTitle}</span>
                    : <span className="text-[#888]">Выбрать или создать игру</span>}
                </div>
                <span className="text-[#555] text-xs ml-2">{gamePickerOpen ? '▲' : '▼'}</span>
              </button>

              {gamePickerOpen && (
                <div className="mt-3 flex flex-col gap-3">
                  {/* Переключатель режима */}
                  <div className="flex gap-1 bg-[#0A0A0A] rounded-xl p-1">
                    <button
                      onClick={() => setCustomGameOpen(false)}
                      className={`flex-1 py-1.5 text-xs rounded-lg transition-colors ${!customGameOpen ? 'bg-[#1E1E1E] text-white' : 'text-[#555] hover:text-[#888]'}`}
                    >
                      Из бота
                    </button>
                    <button
                      onClick={() => setCustomGameOpen(true)}
                      className={`flex-1 py-1.5 text-xs rounded-lg transition-colors ${customGameOpen ? 'bg-[#1E1E1E] text-white' : 'text-[#555] hover:text-[#888]'}`}
                    >
                      + Создать свою
                    </button>
                  </div>

                  {/* Список игр из бота */}
                  {!customGameOpen && (
                    botGames.length === 0 ? (
                      <div className="text-[#444] text-sm">Загрузка игр из бота...</div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {botGames.map(g => {
                          const isSelected = gameState.tournamentBotId === g.id;
                          const d = new Date(g.date);
                          const dateStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                          return (
                            <button
                              key={g.id}
                              onClick={() => updateGameState({ tournamentTitle: g.title, tournamentBotId: g.id })}
                              className={`flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-all ${
                                isSelected
                                  ? 'border-[#C0392B] bg-[#1a0a00] text-white'
                                  : 'border-[#2D2D2D] bg-[#0A0A0A] text-[#888] hover:border-[#444]'
                              }`}
                            >
                              <div>
                                <div className={`font-bold uppercase text-sm ${isSelected ? 'text-white' : 'text-[#666]'}`}>{g.title}</div>
                                <div className="text-xs text-[#444] mt-0.5">{dateStr}</div>
                              </div>
                              <div className="text-right ml-3">
                                <div className={`text-sm font-bold ${isSelected ? 'text-[#C0392B]' : 'text-[#444]'}`}>{g.confirmed} / {g.max_players}</div>
                                {isSelected && <div className="text-[#C0392B] text-xs">✓</div>}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )
                  )}

                  {/* Создать свою игру */}
                  {customGameOpen && (
                    <div className="flex flex-col gap-2">
                      <input
                        type="text"
                        value={customGameTitle}
                        onChange={e => setCustomGameTitle(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && customGameTitle.trim()) {
                            updateGameState({ tournamentTitle: customGameTitle.trim(), tournamentBotId: null });
                            setCustomGameTitle('');
                            setGamePickerOpen(false);
                          }
                        }}
                        placeholder="Название игры..."
                        className="bg-[#0A0A0A] border border-[#2D2D2D] rounded-xl px-4 py-3 text-white text-sm placeholder-[#444] focus:outline-none focus:border-[#C0392B]"
                      />
                      <button
                        onClick={() => {
                          if (!customGameTitle.trim()) return;
                          updateGameState({ tournamentTitle: customGameTitle.trim(), tournamentBotId: null });
                          setCustomGameTitle('');
                          setGamePickerOpen(false);
                        }}
                        disabled={!customGameTitle.trim()}
                        className="admin-btn-primary py-3 text-sm disabled:opacity-30"
                      >
                        Создать игру
                      </button>
                    </div>
                  )}

                  {/* Сбросить выбор */}
                  {gameState.tournamentTitle && (
                    <button
                      onClick={() => updateGameState({ tournamentTitle: '', tournamentBotId: null })}
                      className="text-[#444] text-xs text-center hover:text-[#888] py-1"
                    >
                      Сбросить выбор
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ── Следующая игра ──────────────────────────────────── */}
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              <button
                onClick={() => setNextGamePickerOpen(o => !o)}
                className="flex items-center justify-between w-full"
              >
                <div className="text-sm">
                  {gameState.nextGameBotId != null
                    ? (() => {
                        const found = botGames.find(g => g.id === gameState.nextGameBotId);
                        return found
                          ? <span className="text-white font-bold">Далее: {found.title}</span>
                          : <span className="text-[#888]">Следующая игра (ID: {gameState.nextGameBotId})</span>;
                      })()
                    : <span className="text-[#888]">Выбрать следующую игру</span>}
                </div>
                <span className="text-[#555] text-xs ml-2">{nextGamePickerOpen ? '▲' : '▼'}</span>
              </button>

              {nextGamePickerOpen && (
                <div className="mt-3 flex flex-col gap-2">
                  {botGames.length === 0 ? (
                    <div className="text-[#444] text-sm">Загрузка игр из бота...</div>
                  ) : (
                    botGames.map(g => {
                      const isSelected = gameState.nextGameBotId === g.id;
                      const d = new Date(g.date);
                      const dateStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                      return (
                        <button
                          key={g.id}
                          onClick={() => {
                            updateGameState({ nextGameBotId: isSelected ? null : g.id });
                            setNextGamePickerOpen(false);
                          }}
                          className={`flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-all ${
                            isSelected
                              ? 'border-[#C0392B] bg-[#1a0a00] text-white'
                              : 'border-[#2D2D2D] bg-[#0A0A0A] text-[#888] hover:border-[#444]'
                          }`}
                        >
                          <div>
                            <div className={`font-bold uppercase text-sm ${isSelected ? 'text-white' : 'text-[#666]'}`}>{g.title}</div>
                            <div className="text-xs text-[#444] mt-0.5">{dateStr}</div>
                          </div>
                          <div className="text-right ml-3">
                            <div className={`text-sm font-bold ${isSelected ? 'text-[#C0392B]' : 'text-[#444]'}`}>{g.confirmed} / {g.max_players}</div>
                            {isSelected && <div className="text-[#C0392B] text-xs">✓</div>}
                          </div>
                        </button>
                      );
                    })
                  )}
                  {gameState.nextGameBotId != null && (
                    <button
                      onClick={() => updateGameState({ nextGameBotId: null })}
                      className="text-[#444] text-xs text-center hover:text-[#888] py-1"
                    >
                      Сбросить выбор
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ── Статус турнира ───────────────────────────────────── */}
            {gameState.status === 'ended' ? (
              /* Экран завершения */
              <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-5 text-center flex flex-col gap-4">
                <div className="text-white font-black text-xl uppercase tracking-widest">Турнир завершён</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="bg-[#0A0A0A] rounded-xl p-3">
                    <div className="text-[#555] text-xs uppercase mb-1">Игроков</div>
                    <div className="text-white font-black text-2xl">{gameState.players}</div>
                  </div>
                  <div className="bg-[#0A0A0A] rounded-xl p-3">
                    <div className="text-[#555] text-xs uppercase mb-1">Ребаев</div>
                    <div className="text-white font-black text-2xl">{gameState.rebuys ?? 0}</div>
                  </div>
                  <div className="bg-[#0A0A0A] rounded-xl p-3">
                    <div className="text-[#555] text-xs uppercase mb-1">Аддонов</div>
                    <div className="text-white font-black text-2xl">{gameState.addonCount ?? 0}</div>
                  </div>
                  <div className="bg-[#0A0A0A] rounded-xl p-3">
                    <div className="text-[#555] text-xs uppercase mb-1">Бонусов</div>
                    <div className="text-white font-black text-2xl">{gameState.bonusCount ?? 0}</div>
                  </div>
                </div>
                <div className="bg-[#0A0A0A] rounded-xl p-3">
                  <div className="text-[#555] text-xs uppercase mb-1">Всего фишек в игре</div>
                  <div className="text-[#C0392B] font-black text-3xl">{(gameState.totalStack ?? 0).toLocaleString('ru-RU')}</div>
                </div>
                <button
                  onClick={async () => {
                    if (confirm('Завершить и начать новый турнир? Данные сохранятся в архив.')) {
                      await saveTournament(gameState, gameState.currentLevelIndex + 1);
                      resetTournament();
                    }
                  }}
                  className="admin-btn-primary py-4 text-base font-bold"
                >
                  ↺ Новый турнир
                </button>
              </div>
            ) : (
              <>
                {/* Timer display */}
                <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
                  {/* Прогресс уровней */}
                  {(() => {
                    const total = blindLevels.length;
                    const cur = gameState.currentLevelIndex;
                    return total > 0 ? (
                      <div className="mb-4">
                        <div className="flex justify-between text-xs text-[#444] mb-1">
                          <span>
                            {currentLevel?.isBreak
                              ? (currentLevel.breakLabel || 'ПЕРЕРЫВ')
                              : `Уровень ${currentLevel?.level ?? '—'}`}
                          </span>
                          <span>{cur + 1} / {total}</span>
                        </div>
                        <div className="h-1.5 bg-[#1E1E1E] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#C0392B] rounded-full transition-all"
                            style={{ width: `${((cur + 1) / total) * 100}%` }}
                          />
                        </div>
                      </div>
                    ) : null;
                  })()}

                  {/* Время + статус */}
                  <div className="flex items-center justify-between gap-3">
                    <div
                      className="font-mono font-black tabular-nums"
                      style={{ fontSize: 'clamp(44px, 12vw, 72px)', lineHeight: 1 }}
                    >
                      {gameState.status === 'idle'
                        ? <span className="text-[#444]">--:--</span>
                        : <span className={gameState.timeLeft <= 60 && isRunning ? 'text-[#C0392B]' : 'text-white'}>
                            {String(minutes).padStart(2,'0')}:{String(seconds).padStart(2,'0')}
                          </span>
                      }
                    </div>
                    <div className="text-right">
                      <StatusBadge status={gameState.status} />
                      {currentLevel && !currentLevel.isBreak && (
                        <div className="text-[#555] text-xs mt-2">
                          {currentLevel.sb} / {currentLevel.bb}
                          {currentLevel.ante > 0 ? ` + ${currentLevel.ante}` : ''}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Play/Pause — большая кнопка */}
                <button
                  onClick={isRunning ? pauseTimer : startTimer}
                  className={`w-full py-5 rounded-xl font-black text-2xl tracking-wide transition-colors ${
                    isRunning
                      ? 'bg-[#2D2D2D] hover:bg-[#3D3D3D] text-white'
                      : 'bg-[#C0392B] hover:bg-[#E31E24] text-white'
                  }`}
                >
                  {isRunning ? '⏸ Пауза' : '▶ Запустить'}
                </button>

                {/* Уровни и сброс */}
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={prevLevel} className="admin-btn-secondary py-4 text-base">← Уровень</button>
                  <button onClick={nextLevel} className="admin-btn-secondary py-4 text-base">Уровень →</button>
                  <button
                    onClick={() => {
                      const lvl = blindLevels[gameState.currentLevelIndex];
                      if (lvl) updateGameState({ timeLeft: lvl.duration });
                    }}
                    className="admin-btn-secondary py-4 text-sm"
                  >
                    ↺ Сбросить время
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm('Завершить турнир? Данные будут сохранены в архив.')) {
                        await saveTournament(gameState, gameState.currentLevelIndex + 1);
                        resetTournament();
                      }
                    }}
                    className="admin-btn-danger py-4 text-sm"
                  >
                    ✕ Завершить
                  </button>
                </div>
              </>
            )}

            {/* Time adjustment — 3x2 grid */}
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              <div className="text-[#888] text-xs uppercase tracking-widest mb-3">Корректировка времени</div>
              <div className="grid grid-cols-3 gap-2">
                {([-60, -300, -600, +60, +300, +600] as const).map(delta => {
                  const isNeg = delta < 0;
                  const abs = Math.abs(delta);
                  const label = `${abs / 60} мин`;
                  return (
                    <button
                      key={delta}
                      onClick={() => updateGameState({ timeLeft: Math.max(0, gameState.timeLeft + delta) })}
                      className={`py-3 rounded-lg font-bold text-sm transition-colors ${
                        isNeg
                          ? 'bg-red-900/60 hover:bg-red-800 text-red-300'
                          : 'bg-green-900/60 hover:bg-green-800 text-green-300'
                      }`}
                    >
                      {isNeg ? '−' : '+'}{label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Player / Stack */}
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4 flex flex-col gap-4">
              <div className="text-[#888] text-xs uppercase tracking-widest">Участники и стеки</div>

              {/* Стартовый стек */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[#666] text-xs block mb-1">Стартовый стек</label>
                  <input
                    type="number"
                    className="admin-input"
                    value={gameState.startStack || ''}
                    onChange={e => {
                      updateStackState({ startStack: Number(e.target.value) });
                    }}
                    placeholder="напр. 15000"
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label className="text-[#666] text-xs block mb-1">Стек аддона</label>
                  <input
                    type="number"
                    className="admin-input"
                    value={gameState.addonStack || ''}
                    onChange={e => {
                      updateStackState({ addonStack: Number(e.target.value) });
                    }}
                    placeholder="напр. 20000"
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label className="text-[#666] text-xs block mb-1">Стек бонуса</label>
                  <input
                    type="number"
                    className="admin-input"
                    value={gameState.bonusStack || ''}
                    onChange={e => {
                      updateStackState({ bonusStack: Number(e.target.value) });
                    }}
                    placeholder="напр. 5000"
                    inputMode="numeric"
                  />
                </div>
              </div>

              {/* Игроки · Ребаи · Аддоны · Бонусы */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <CounterBlock
                  label="Игроки"
                  value={gameState.players ?? 0}
                  onAdd={() => updateStackState({ players: (gameState.players ?? 0) + 1 })}
                  onRemove={() => updateStackState({ players: Math.max(0, (gameState.players ?? 0) - 1) })}
                />
                <CounterBlock
                  label="Ребаи"
                  value={gameState.rebuys ?? 0}
                  onAdd={() => updateStackState({ rebuys: (gameState.rebuys ?? 0) + 1 })}
                  onRemove={() => updateStackState({ rebuys: Math.max(0, (gameState.rebuys ?? 0) - 1) })}
                />
                <CounterBlock
                  label="Аддоны"
                  value={gameState.addonCount ?? 0}
                  onAdd={() => updateStackState({ addonCount: (gameState.addonCount ?? 0) + 1 })}
                  onRemove={() => updateStackState({ addonCount: Math.max(0, (gameState.addonCount ?? 0) - 1) })}
                />
                <CounterBlock
                  label="Бонусы"
                  value={gameState.bonusCount ?? 0}
                  onAdd={() => updateStackState({ bonusCount: (gameState.bonusCount ?? 0) + 1 })}
                  onRemove={() => updateStackState({ bonusCount: Math.max(0, (gameState.bonusCount ?? 0) - 1) })}
                />
              </div>

              {/* Итого */}
              {gameState.totalStack > 0 && (
                <div className="bg-[#0A0A0A] rounded-xl px-4 py-3 flex items-center justify-between">
                  <span className="text-[#666] text-sm">Общий стек</span>
                  <span className="text-white font-black text-2xl">
                    {gameState.totalStack.toLocaleString('ru-RU')}
                  </span>
                </div>
              )}
            </div>

            {/* Ауты */}
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              <div className="text-[#888] text-xs uppercase tracking-widest mb-3">Выбыли</div>
              <div className="flex items-center gap-4">
                <div className="w-32 flex-shrink-0">
                  <CounterBlock
                    label="Ауты"
                    value={gameState.outs ?? 0}
                    onAdd={() => updateGameState({ outs: Math.min((gameState.players ?? 0), (gameState.outs ?? 0) + 1) })}
                    onRemove={() => updateGameState({ outs: Math.max(0, (gameState.outs ?? 0) - 1) })}
                  />
                </div>
                {(gameState.players ?? 0) > 0 && (
                  <div className="text-sm leading-relaxed">
                    <div className="text-[#555] mb-1 text-xs">Осталось в игре</div>
                    <div>
                      <span className="text-white font-black text-4xl">
                        {(gameState.players ?? 0) - (gameState.outs ?? 0)}
                      </span>
                      <span className="text-[#444] text-xl"> / {gameState.players}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Rating toggle */}
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-white font-medium text-sm">Показать рейтинг на экране</div>
                  <div className="text-[#555] text-xs mt-0.5">Заменяет таймер на таблицу рейтинга</div>
                </div>
                <button
                  onClick={() => updateGameState({ showRating: !gameState.showRating })}
                  className={`w-14 h-7 rounded-full transition-colors flex-shrink-0 ml-4 ${
                    gameState.showRating ? 'bg-[#C0392B]' : 'bg-[#2D2D2D]'
                  }`}
                >
                  <div className={`w-6 h-6 bg-white rounded-full mx-0.5 transition-transform ${
                    gameState.showRating ? 'translate-x-7' : 'translate-x-0'
                  }`} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── BLINDS TAB ──────────────────────────────────────────────── */}
        {activeTab === 'blinds' && (
          <div className="flex flex-col gap-3">
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="text-[#888] text-xs uppercase tracking-widest">Анте</div>
                  <div className="text-[#555] text-xs mt-1">
                    Анте всегда равно BB. Здесь можно быстро включить его с нужного уровня, и эта схема сохранится в шаблонах.
                  </div>
                </div>

                <div className="w-full sm:w-[240px]">
                  <select
                    className="admin-input"
                    value={String(anteStartLevel)}
                    onChange={e => applyAnteStartLevel(Number(e.target.value))}
                    disabled={regularBlindLevels.length === 0}
                  >
                    <option value="0">Без анте</option>
                    {regularBlindLevels.map(level => (
                      <option key={level.id} value={level.level}>
                        С уровня {level.level}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[#888] text-xs uppercase tracking-widest">Шаблоны блайндов</div>
                    <div className="text-[#555] text-xs mt-1">
                      Сохраните текущую структуру под именем и потом быстро применяйте нужный шаблон.
                    </div>
                  </div>
                  <div className="rounded-full border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-1 text-[11px] uppercase tracking-wide text-[#777]">
                    {sharedBlindTemplateLibraryEnabled ? 'Общая библиотека' : 'Локально на этом устройстве'}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_220px] gap-2">
                  <input
                    className="admin-input"
                    placeholder="Название шаблона"
                    value={templateName}
                    onChange={e => setTemplateName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && void saveCurrentBlindTemplate()}
                  />
                  <button
                    onClick={() => void saveCurrentBlindTemplate()}
                    className={`admin-btn-primary px-4 py-3 text-sm ${templateBusy ? 'opacity-60 pointer-events-none' : ''}`}
                  >
                    {templateBusy ? 'Сохранение...' : 'Сохранить текущий шаблон'}
                  </button>
                </div>

                {templateError && (
                  <div className="rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                    {templateError}
                  </div>
                )}

                {templateNote && (
                  <div className="rounded-xl border border-[#3A3A3A] bg-[#0A0A0A] px-3 py-2 text-sm text-[#AAA]">
                    {templateNote}
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {allBlindTemplates.map(template => (
                    <div key={template.id} className="rounded-2xl border border-[#2D2D2D] bg-[#0A0A0A] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-white font-bold text-sm">{template.name}</div>
                          <div className="text-[#666] text-xs mt-1">
                            Уровней: {template.levels.filter(level => !level.isBreak).length}
                            {template.levels.some(level => level.isBreak)
                              ? ` · Перерывов: ${template.levels.filter(level => level.isBreak).length}`
                              : ''}
                          </div>
                        </div>
                        {template.id.startsWith('preset_') && (
                          <span className="rounded-full bg-[#1F1F1F] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#AAA]">
                            Базовый
                          </span>
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          onClick={() => void applyBlindTemplate(template)}
                          className="admin-btn-primary px-4 py-2 text-sm"
                        >
                          Применить
                        </button>
                        {!template.id.startsWith('preset_') && (
                          <button
                            onClick={() => void removeBlindTemplate(template.id)}
                            className="admin-btn-danger px-4 py-2 text-sm"
                          >
                            Удалить
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-1">
              <button onClick={addBlindLevel} className="admin-btn-primary px-4 py-3 text-sm">+ Уровень</button>
              <button onClick={addBreak} className="admin-btn-secondary px-4 py-3 text-sm">+ Перерыв</button>
            </div>

            {blindLevels.map((level, idx) => (
              <div
                key={level.id}
                ref={el => { rowEls.current[idx] = el; }}
                className="relative"
              >
                {/* Drop indicator line above this row */}
                {dropLine === idx && dragIdx !== null && dragIdx !== idx && (
                  <div className="absolute -top-1.5 left-10 right-0 h-0.5 bg-[#E31E24] rounded-full z-10 pointer-events-none" />
                )}

                <div className={`flex items-start gap-2 ${dragIdx === idx ? 'opacity-30' : ''}`}>
                  {/* Drag handle column */}
                  <div className="flex flex-col items-center gap-0.5 pt-2 flex-shrink-0">
                    <button
                      onClick={() => moveLevel(idx, -1)}
                      disabled={idx === 0}
                      className="w-8 h-7 flex items-center justify-center text-[#444] disabled:opacity-20 hover:text-white transition-colors text-xs"
                    >▲</button>
                    <div
                      className="w-8 h-8 flex items-center justify-center text-[#555] hover:text-[#888] text-xl select-none cursor-grab active:cursor-grabbing"
                      style={{ touchAction: 'none' }}
                      onPointerDown={e => {
                        e.preventDefault();
                        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                        dragging.current = true;
                        setDragIdx(idx);
                        setDropLine(null);
                      }}
                      onPointerMove={e => {
                        if (!dragging.current) return;
                        setDropLine(getDropLine(e.clientY));
                      }}
                      onPointerUp={commitDrop}
                      onPointerCancel={commitDrop}
                    >⠿</div>
                    <button
                      onClick={() => moveLevel(idx, 1)}
                      disabled={idx === blindLevels.length - 1}
                      className="w-8 h-7 flex items-center justify-center text-[#444] disabled:opacity-20 hover:text-white transition-colors text-xs"
                    >▼</button>
                  </div>

                  {/* Row content */}
                  <div className="flex-1 min-w-0">
                    <BlindRow
                      level={level}
                      onChange={l => updateLevel(idx, l)}
                      onDelete={() => deleteLevel(idx)}
                    />
                  </div>
                </div>
              </div>
            ))}

            {/* Drop indicator at end of list */}
            {dropLine === blindLevels.length && dragIdx !== null && (
              <div className="h-0.5 bg-[#E31E24] rounded-full ml-10" />
            )}
          </div>
        )}

        {/* ─── COMBOS TAB ──────────────────────────────────────────────── */}
        {activeTab === 'combos' && (
          <div className="flex flex-col gap-4">
            <button onClick={addCombo} className="admin-btn-primary px-4 py-3 text-sm">+ Добавить комбинацию</button>

            {combinations.map((combo, comboIdx) => (
              <div key={combo.id} className="bg-[#111] border border-[#2D2D2D] rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[#888] text-sm">Комбо {comboIdx + 1}</span>
                    <button
                      onClick={() => updateCombo(comboIdx, { ...combo, enabled: !combo.enabled })}
                      className={`text-xs px-2 py-1 rounded ${combo.enabled ? 'bg-green-700 text-white' : 'bg-[#2D2D2D] text-[#666]'}`}
                    >
                      {combo.enabled ? 'Вкл' : 'Выкл'}
                    </button>
                  </div>
                  <button onClick={() => deleteCombo(comboIdx)} className="admin-btn-danger px-3 py-2 text-sm">✕</button>
                </div>

                {/* Cards */}
                <div className="flex items-center gap-1 flex-wrap mb-3">
                  {combo.cards.map((card, cardIdx) => (
                    <div key={cardIdx} className="relative group">
                      <PokerCard card={card} size="sm" />
                      <button
                        onClick={() => removeCardFromCombo(comboIdx, cardIdx)}
                        className="absolute -top-1 -right-1 bg-red-700 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center"
                      >✕</button>
                    </div>
                  ))}
                </div>
                <CardPicker onAdd={card => addCardToCombo(comboIdx, card)} />

                {/* Description */}
                <input
                  className="admin-input mt-3"
                  placeholder="Описание (напр: +5 очков к рейтингу)"
                  value={combo.description}
                  onChange={e => updateCombo(comboIdx, { ...combo, description: e.target.value })}
                />
              </div>
            ))}
          </div>
        )}

        {/* ─── ARCHIVE TAB ─────────────────────────────────────────────── */}
        {activeTab === 'archive' && (
          <div className="flex flex-col gap-3">
            <div className="text-[#555] text-xs uppercase tracking-widest mb-1">
              История завершённых турниров
            </div>

            {archiveLoading && (
              <div className="text-[#444] text-sm text-center py-8">Загрузка...</div>
            )}

            {!archiveLoading && tournaments.length === 0 && (
              <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-8 text-center">
                <div className="text-[#444] text-4xl mb-3">📋</div>
                <div className="text-[#555] text-sm">Архив пуст</div>
                <div className="text-[#333] text-xs mt-1">
                  После завершения турнира данные появятся здесь
                </div>
              </div>
            )}

            {tournaments.map(t => {
              const date = new Date(t.finished_at);
              const dateStr = date.toLocaleDateString('ru-RU', {
                day: 'numeric', month: 'short', year: 'numeric',
              });
              const timeStr = date.toLocaleTimeString('ru-RU', {
                hour: '2-digit', minute: '2-digit',
              });
              const activePlayers = t.players - 0; // players who finished
              return (
                <div key={t.id} className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4 flex flex-col gap-3">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-white font-bold text-sm uppercase tracking-wide">
                        {t.title || 'Без названия'}
                      </div>
                      <div className="text-[#444] text-xs mt-0.5">{dateStr} · {timeStr}</div>
                    </div>
                    <div className="text-[#C0392B] font-black text-lg whitespace-nowrap">
                      {(t.total_stack ?? 0).toLocaleString('ru-RU')}
                      <span className="text-[#555] text-xs font-normal ml-1">фишек</span>
                    </div>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-4 gap-2">
                    <div className="bg-[#0A0A0A] rounded-xl p-2 text-center">
                      <div className="text-[#555] text-[10px] uppercase mb-0.5">Игроки</div>
                      <div className="text-white font-black text-lg">{t.players}</div>
                    </div>
                    <div className="bg-[#0A0A0A] rounded-xl p-2 text-center">
                      <div className="text-[#555] text-[10px] uppercase mb-0.5">Ребаи</div>
                      <div className="text-white font-black text-lg">{t.rebuys}</div>
                    </div>
                    <div className="bg-[#0A0A0A] rounded-xl p-2 text-center">
                      <div className="text-[#555] text-[10px] uppercase mb-0.5">Аддоны</div>
                      <div className="text-white font-black text-lg">{t.addon_count}</div>
                    </div>
                    <div className="bg-[#0A0A0A] rounded-xl p-2 text-center">
                      <div className="text-[#555] text-[10px] uppercase mb-0.5">Уровней</div>
                      <div className="text-white font-black text-lg">{t.levels_played}</div>
                    </div>
                  </div>

                  {/* Buy-ins + delete */}
                  <div className="flex items-center justify-between">
                    {activePlayers > 0 && (
                      <div className="text-[#444] text-xs">
                        Всего buy-in: {t.players + t.rebuys + t.addon_count}
                      </div>
                    )}
                    {confirmDeleteId === t.id ? (
                      <div className="flex items-center gap-2 ml-auto">
                        <span className="text-[#888] text-xs">Удалить?</span>
                        <button
                          onClick={async () => {
                            await deleteTournament(t.id);
                            setTournaments(prev => prev.filter(x => x.id !== t.id));
                            setConfirmDeleteId(null);
                          }}
                          className="text-[#C0392B] text-xs font-bold px-3 py-1 border border-[#C0392B] rounded-lg hover:bg-[#1a0a00] transition-colors"
                        >
                          Да, удалить
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-[#555] text-xs px-3 py-1 border border-[#2D2D2D] rounded-lg hover:text-[#888] transition-colors"
                        >
                          Отмена
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(t.id)}
                        className="text-[#333] text-xs hover:text-[#C0392B] transition-colors ml-auto py-1"
                      >
                        Удалить
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ─── SETTINGS TAB ────────────────────────────────────────────── */}
        {activeTab === 'settings' && (
          <div className="flex flex-col gap-4">
            {/* Next game info */}
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              <div className="text-[#888] text-xs uppercase tracking-widest mb-3">Следующая игра</div>
              <input
                className="admin-input"
                placeholder="напр: Ребайный турнир · 24.04.26 · 20:00"
                value={gameState.nextGameInfo}
                onChange={e => updateGameState({ nextGameInfo: e.target.value })}
              />
              <div className="text-[#555] text-xs mt-1">Отображается внизу экрана</div>
            </div>

            {/* Background */}
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="text-[#888] text-xs uppercase tracking-widest">Фон экрана</div>
                  <div className="text-[#555] text-xs mt-1">
                    {sharedBackgroundLibraryEnabled
                      ? 'Готовая библиотека доступна сразу. Загруженные изображения сохраняются в общей библиотеке и видны с любого устройства.'
                      : 'Готовая библиотека доступна сразу. Без Supabase свои изображения сохраняются только в браузере админа.'}
                  </div>
                </div>
                <label className={`admin-btn-primary px-4 py-2 text-sm ${backgroundUploadBusy ? 'opacity-60 pointer-events-none' : ''}`}>
                  {backgroundUploadBusy ? 'Загрузка...' : '+ Загрузить фон'}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleBackgroundUpload}
                  />
                </label>
              </div>

              {backgroundUploadError && (
                <div className="mb-3 rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                  {backgroundUploadError}
                </div>
              )}

              {backgroundUploadNote && (
                <div className="mb-3 rounded-xl border border-[#3A3A3A] bg-[#0A0A0A] px-3 py-2 text-sm text-[#AAA]">
                  {backgroundUploadNote}
                </div>
              )}

              <div className="mb-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-wide text-[#777]">
                <span className="rounded-full border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-1">
                  Готовые: {PRESET_BACKGROUNDS.length}
                </span>
                <span className="rounded-full border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-1">
                  Свои: {backgroundLibrary.length}
                </span>
                <span className="rounded-full border border-[#2D2D2D] bg-[#0A0A0A] px-3 py-1">
                  {sharedBackgroundLibraryEnabled ? 'Общая библиотека' : 'Локально на этом устройстве'}
                </span>
              </div>

              <div className="mb-3 text-[#666] text-xs uppercase tracking-widest">Библиотека фонов</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
                <BackgroundTile
                  title="По умолчанию"
                  subtitle="Темный фон без картинки"
                  selected={!gameState.backgroundUrl}
                  onClick={() => updateGameState({ backgroundUrl: null })}
                />

                {allBackgrounds.map(background => (
                  <BackgroundTile
                    key={background.id}
                    title={background.name}
                    subtitle={
                      background.id.startsWith('preset_')
                        ? 'Готовый фон'
                        : `${background.width}×${background.height}`
                    }
                    previewUrl={background.url}
                    selected={gameState.backgroundUrl === background.url}
                    onClick={() => updateGameState({ backgroundUrl: background.url })}
                    onDelete={
                      background.id.startsWith('preset_')
                        ? undefined
                        : () => removeBackground(background.id)
                    }
                  />
                ))}
              </div>

              {backgroundLibrary.length === 0 && (
                <div className="rounded-xl border border-dashed border-[#2D2D2D] bg-[#0A0A0A] px-4 py-5 text-sm text-[#666]">
                  {sharedBackgroundLibraryEnabled
                    ? 'Пока нет своих загруженных фонов в общей библиотеке. Готовые варианты уже доступны в сетке выше, а свои можно добавить кнопкой справа.'
                    : 'Пока нет своих загруженных фонов. Готовые варианты уже доступны в сетке выше, а свои можно добавить кнопкой справа.'}
                </div>
              )}

              <div className="mt-4 border-t border-[#1F1F1F] pt-4">
                <div className="text-[#666] text-xs uppercase tracking-widest mb-2">Ручной URL</div>
                <input
                  className="admin-input"
                  placeholder="https://.../background.jpg"
                  value={gameState.backgroundUrl || ''}
                  onChange={e => updateGameState({ backgroundUrl: e.target.value || null })}
                />
                <div className="text-[#555] text-xs mt-1">
                  Если нужен внешний файл, ссылку можно вставить вручную. Загруженные выше фоны выбирать удобнее через сетку.
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
    </ErrorBoundary>
  );
}

function BackgroundTile({
  title,
  subtitle,
  previewUrl,
  selected,
  onClick,
  onDelete,
}: {
  title: string;
  subtitle: string;
  previewUrl?: string;
  selected: boolean;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border text-left transition-all ${
        selected
          ? 'border-[#C0392B] ring-1 ring-[#C0392B] bg-[#140909]'
          : 'border-[#2D2D2D] bg-[#0A0A0A] hover:border-[#4A4A4A]'
      }`}
    >
      <button type="button" onClick={onClick} className="block w-full text-left">
        {previewUrl ? (
          <div className="relative h-40 w-full bg-black">
            <img src={previewUrl} alt={title} className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
          </div>
        ) : (
          <div className="h-40 w-full bg-[radial-gradient(circle_at_top,#301010_0%,#0A0A0A_72%)]" />
        )}

        <div className="absolute left-0 right-0 top-0 flex items-start justify-between p-3">
          {selected && (
            <span className="rounded-full bg-[#C0392B] px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-white">
              Активен
            </span>
          )}
        </div>

        <div className="relative z-10 px-3 pb-3 pt-2">
          <div className="truncate text-sm font-bold text-white">{title}</div>
          <div className="mt-1 text-xs text-[#777]">{subtitle}</div>
        </div>
      </button>

      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="absolute right-2 top-2 z-20 rounded-full bg-black/75 px-2 py-1 text-xs font-bold text-red-300 transition-colors hover:bg-red-900/70"
        >
          Удалить
        </button>
      )}
    </div>
  );
}

// ─── Status badge ────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; color: string }> = {
    idle:    { label: 'Не запущен', color: 'bg-[#2D2D2D] text-[#666]' },
    running: { label: '▶ Идёт игра', color: 'bg-green-900/60 text-green-400' },
    paused:  { label: '⏸ Пауза',    color: 'bg-yellow-900/60 text-yellow-400' },
    break:   { label: '☕ Перерыв', color: 'bg-blue-900/40 text-blue-300' },
    ended:   { label: 'Завершён',   color: 'bg-[#2D2D2D] text-[#666]' },
  };
  const c = cfg[status] ?? cfg.idle;
  return (
    <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${c.color}`}>
      {c.label}
    </span>
  );
}

// ─── Counter block ────────────────────────────────────────────────────────
const CounterBlock = React.memo(function CounterBlock({
  label,
  sublabel,
  value,
  onAdd,
  onRemove,
}: {
  label: string;
  sublabel?: string;
  value: number;
  onAdd: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="bg-[#0A0A0A] rounded-xl px-2 py-3 flex flex-col items-center gap-2">
      <div className="text-center">
        <div className="text-[#666] text-[10px] uppercase tracking-widest leading-tight">{label}</div>
        {sublabel && <div className="text-[#444] text-[9px] leading-tight">{sublabel}</div>}
      </div>
      <div className="text-white font-black text-3xl leading-none">{value}</div>
      <div className="flex gap-1 w-full">
        <button
          onClick={onRemove}
          className="flex-1 py-3 rounded-lg bg-[#2D2D2D] text-[#888] hover:bg-[#3D3D3D] font-bold text-lg transition-colors"
        >
          −
        </button>
        <button
          onClick={onAdd}
          className="flex-1 py-3 rounded-lg bg-[#C0392B] text-white hover:bg-[#E31E24] font-bold text-base transition-colors"
        >
          +1
        </button>
      </div>
    </div>
  );
})
