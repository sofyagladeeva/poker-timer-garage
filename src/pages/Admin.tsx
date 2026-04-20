import { useState, useEffect } from 'react';
import { useGameState } from '../hooks/useGameState';
import type { BlindLevel, Combination, Card, Suit, Rank } from '../types';
import { SUIT_SYMBOLS } from '../types';
import { PokerCard } from '../components/PokerCard';

const BOT_API = import.meta.env.VITE_BOT_API_URL || 'https://web-production-6035.up.railway.app';

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || 'poker2024';

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

// ─── Blind level row (mobile-friendly) ────────────────────────────────────
function BlindRow({
  level,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  level: BlindLevel;
  onChange: (l: BlindLevel) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const upd = (patch: Partial<BlindLevel>) => onChange({ ...level, ...patch });

  const moveButtons = (
    <div className="flex flex-col gap-0.5">
      <button
        onClick={onMoveUp}
        disabled={isFirst}
        className="w-8 h-7 flex items-center justify-center rounded bg-[#1A1A1A] text-[#666] disabled:opacity-20 hover:bg-[#2D2D2D] hover:text-white transition-colors text-xs"
      >▲</button>
      <button
        onClick={onMoveDown}
        disabled={isLast}
        className="w-8 h-7 flex items-center justify-center rounded bg-[#1A1A1A] text-[#666] disabled:opacity-20 hover:bg-[#2D2D2D] hover:text-white transition-colors text-xs"
      >▼</button>
    </div>
  );

  if (level.isBreak) {
    return (
      <div className="bg-blue-900/20 border border-blue-700/30 rounded-xl p-3 flex gap-2 items-center">
        {moveButtons}
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <span className="text-blue-400 text-xs font-bold uppercase tracking-wider">Перерыв</span>
          <div className="grid grid-cols-2 gap-2">
            <input
              className="admin-input"
              placeholder="Название"
              value={level.breakLabel || ''}
              onChange={e => upd({ breakLabel: e.target.value })}
            />
            <div className="flex items-center gap-1">
              <input
                type="number"
                className="admin-input"
                placeholder="мин"
                value={Math.round(level.duration / 60)}
                onChange={e => upd({ duration: Number(e.target.value) * 60 })}
              />
              <span className="text-[#555] text-xs flex-shrink-0">мин</span>
            </div>
          </div>
        </div>
        <button onClick={onDelete} className="admin-btn-danger px-3 py-2 text-sm flex-shrink-0">✕</button>
      </div>
    );
  }

  return (
    <div className="bg-[#111] border border-[#2D2D2D] rounded-xl p-3 flex gap-2 items-center">
      {moveButtons}
      <div className="flex flex-col gap-2 flex-1 min-w-0">
        <span className="text-[#666] text-xs">Ур. {level.level}</span>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-[#555] text-[10px] uppercase tracking-wider mb-1">SB</div>
            <input type="number" className="admin-input text-sm px-2" value={level.sb}
              onChange={e => upd({ sb: Number(e.target.value) })} />
          </div>
          <div>
            <div className="text-[#555] text-[10px] uppercase tracking-wider mb-1">BB</div>
            <input type="number" className="admin-input text-sm px-2" value={level.bb}
              onChange={e => upd({ bb: Number(e.target.value) })} />
          </div>
          <div>
            <div className="text-[#555] text-[10px] uppercase tracking-wider mb-1">Мин</div>
            <input type="number" className="admin-input text-sm px-2" value={Math.round(level.duration / 60)}
              onChange={e => upd({ duration: Number(e.target.value) * 60 })} />
          </div>
        </div>
      </div>
      <button onClick={onDelete} className="admin-btn-danger px-3 py-2 text-sm flex-shrink-0">✕</button>
    </div>
  );
}

// ─── Main Admin page ───────────────────────────────────────────────────────
export function Admin() {
  const [authed, setAuthed] = useState(false);
  const [pwInput, setPwInput] = useState('');
  const [pwError, setPwError] = useState(false);
  const [activeTab, setActiveTab] = useState<'control' | 'blinds' | 'combos' | 'settings'>('control');
  const [gamePickerOpen, setGamePickerOpen] = useState(false);

  const {
    gameState, blindLevels, combinations,
    updateGameState, startTimer, pauseTimer, nextLevel, prevLevel, resetTournament,
    updateBlindLevels, updateCombinations,
  } = useGameState();

  // ── Bot games list ─────────────────────────────────────────────────────
  const [botGames, setBotGames] = useState<{ id: number; title: string; date: string; confirmed: number; max_players: number }[]>([]);
  useEffect(() => {
    fetch(`${BOT_API}/api/games`)
      .then(r => r.json())
      .then(setBotGames)
      .catch(() => {});
  }, []);

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

  // ── Demo data ──────────────────────────────────────────────────────────
  const loadDemo = () => {
    const demoLevels: import('../types').BlindLevel[] = [
      { id: 'd1',  level: 1,  sb: 50,   bb: 100,  ante: 0,    duration: 900, isBreak: false },
      { id: 'd2',  level: 2,  sb: 100,  bb: 200,  ante: 200,  duration: 900, isBreak: false },
      { id: 'd3',  level: 3,  sb: 150,  bb: 300,  ante: 200,  duration: 900, isBreak: false },
      { id: 'd4',  level: 4,  sb: 200,  bb: 400,  ante: 300,  duration: 900, isBreak: false },
      { id: 'd5',  level: 5,  sb: 300,  bb: 600,  ante: 400,  duration: 900, isBreak: false },
      { id: 'd6',  level: 6,  sb: 400,  bb: 800,  ante: 500,  duration: 900, isBreak: false },
      { id: 'd7',  level: 7,  sb: 500,  bb: 1000, ante: 500,  duration: 900, isBreak: false },
      { id: 'd8',  level: 8,  sb: 600,  bb: 1200, ante: 600,  duration: 900, isBreak: false },
      { id: 'd9',  level: 9,  sb: 800,  bb: 1600, ante: 800,  duration: 900, isBreak: false },
      { id: 'd10', level: 10, sb: 1000, bb: 2000, ante: 1000, duration: 900, isBreak: false },
      { id: 'd11', level: 11, sb: 1200, bb: 2400, ante: 1000, duration: 900, isBreak: false },
      { id: 'd12', level: 12, sb: 1500, bb: 3000, ante: 1500, duration: 900, isBreak: false },
      { id: 'd13', level: 13, sb: 2000, bb: 4000, ante: 2000, duration: 900, isBreak: false },
      { id: 'd14', level: 14, sb: 2500, bb: 5000, ante: 2500, duration: 900, isBreak: false },
      { id: 'd15', level: 15, sb: 3000, bb: 6000, ante: 3000, duration: 900, isBreak: false },
      { id: 'd16', level: 16, sb: 4000, bb: 8000, ante: 4000, duration: 900, isBreak: false },
      { id: 'db1', level: 0,  sb: 0,    bb: 0,    ante: 0,    duration: 900, isBreak: true, breakLabel: 'ПЕРЕРЫВ' },
    ];
    updateBlindLevels(demoLevels);
    updateGameState({
      status: 'running',
      currentLevelIndex: 1,
      timeLeft: 900,
      players: 18,
      outs: 2,
      rebuys: 5,
      addonCount: 3,
      startStack: 12000,
      addonStack: 20000,
      totalStack: (18 + 5) * 12000 + 3 * 20000,
      tournamentTitle: 'CRAZY FRIDAY',
      tournamentBotId: null,
      prizeAmount: 18000,
      prizePlaces: 5,
      nextGameInfo: '',
    });
    updateCombinations([
      {
        id: 'demo1',
        cards: [
          { rank: 'A', suit: 'any' },
          { rank: 'K', suit: 'any' },
          { rank: 'Q', suit: 'any' },
          { rank: 'J', suit: 'any' },
          { rank: 'T', suit: 'any' },
        ],
        description: 'Кальян от клуба',
        enabled: true,
      },
      {
        id: 'demo2',
        cards: [
          { rank: '7', suit: 'spades' },
          { rank: '2', suit: 'hearts' },
        ],
        description: '+5 очков к рейтингу',
        enabled: true,
      },
    ]);
  };

  // ── Blind levels editor ────────────────────────────────────────────────
  const addBlindLevel = () => {
    const last = blindLevels.filter(l => !l.isBreak).slice(-1)[0];
    const newLevel: BlindLevel = {
      id: Date.now().toString(),
      level: (last?.level ?? 0) + 1,
      sb: (last?.bb ?? 0),
      bb: (last?.bb ?? 100) * 2,
      ante: last?.ante ?? 0,
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

  // ── Combinations editor ────────────────────────────────────────────────
  const addCombo = () => {
    const newCombo: Combination = {
      id: Date.now().toString(),
      cards: [],
      description: '',
      enabled: true,
    };
    updateCombinations([...combinations, newCombo]);
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
    { id: 'settings',label: '⚙️ Настройки' },
  ] as const;

  return (
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
          <button
            onClick={loadDemo}
            className="text-[#F39C12] text-xs border border-[#F39C12]/30 rounded-lg px-2 py-1.5 hover:bg-[#F39C12]/10 transition-colors"
          >
            ★ Демо
          </button>
          <a
            href="#/"
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

            {/* ── Выбор игры из бота ─────────────────────────────────── */}
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              <button
                onClick={() => setGamePickerOpen(o => !o)}
                className="flex items-center justify-between w-full"
              >
                <div className="text-sm">
                  {gameState.tournamentTitle
                    ? <span className="text-white font-bold">✓ {gameState.tournamentTitle}</span>
                    : <span className="text-[#888]">Выбрать игру из бота</span>}
                </div>
                <span className="text-[#555] text-xs ml-2">{gamePickerOpen ? '▲' : '▼'}</span>
              </button>
              {gamePickerOpen && <div className="mt-3">
              {botGames.length === 0 ? (
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
                  {gameState.tournamentTitle && (
                    <button
                      onClick={() => updateGameState({ tournamentTitle: '', tournamentBotId: null })}
                      className="text-[#444] text-xs text-center hover:text-[#888] mt-1 py-2"
                    >
                      Сбросить выбор
                    </button>
                  )}
                </div>
              )}
              </div>}
            </div>

            {/* ── Статус турнира ───────────────────────────────────── */}
            {gameState.status === 'ended' ? (
              /* Экран завершения */
              <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-5 text-center flex flex-col gap-4">
                <div className="text-white font-black text-xl uppercase tracking-widest">Турнир завершён</div>
                <div className="grid grid-cols-3 gap-2 text-center">
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
                </div>
                <div className="bg-[#0A0A0A] rounded-xl p-3">
                  <div className="text-[#555] text-xs uppercase mb-1">Всего фишек в игре</div>
                  <div className="text-[#C0392B] font-black text-3xl">{(gameState.totalStack ?? 0).toLocaleString('ru-RU')}</div>
                </div>
                <button
                  onClick={() => { if (confirm('Сбросить и начать новый турнир?')) resetTournament(); }}
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
                          {currentLevel.sb} / {currentLevel.bb} / {currentLevel.bb}
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
                    onClick={() => { if (confirm('Сбросить турнир?')) resetTournament(); }}
                    className="admin-btn-danger py-4 text-sm"
                  >
                    ✕ Сбросить
                  </button>
                </div>
              </>
            )}

            {/* Time adjustment — 3x2 grid */}
            <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-4">
              <div className="text-[#888] text-xs uppercase tracking-widest mb-3">Корректировка времени</div>
              <div className="grid grid-cols-3 gap-2">
                {([-300, -60, -30, +30, +60, +300] as const).map(delta => {
                  const isNeg = delta < 0;
                  const abs = Math.abs(delta);
                  const label = abs >= 60 ? `${abs / 60} мин` : `${abs} с`;
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#666] text-xs block mb-1">Стартовый стек</label>
                  <input
                    type="number"
                    className="admin-input"
                    value={gameState.startStack || ''}
                    onChange={e => {
                      const ss = Number(e.target.value);
                      const total = (gameState.players + gameState.rebuys) * ss + gameState.addonCount * gameState.addonStack;
                      updateGameState({ startStack: ss, totalStack: total });
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
                      const as = Number(e.target.value);
                      const total = (gameState.players + gameState.rebuys) * gameState.startStack + gameState.addonCount * as;
                      updateGameState({ addonStack: as, totalStack: total });
                    }}
                    placeholder="напр. 20000"
                    inputMode="numeric"
                  />
                </div>
              </div>

              {/* Игроки · Ребаи · Аддоны */}
              <div className="grid grid-cols-3 gap-2">
                <CounterBlock
                  label="Игроки"
                  value={gameState.players ?? 0}
                  onAdd={() => {
                    const p = (gameState.players ?? 0) + 1;
                    const r = gameState.rebuys ?? 0;
                    const a = gameState.addonCount ?? 0;
                    const ss = gameState.startStack ?? 0;
                    const as = gameState.addonStack ?? 0;
                    updateGameState({ players: p, totalStack: (p + r) * ss + a * as });
                  }}
                  onRemove={() => {
                    const p = Math.max(0, (gameState.players ?? 0) - 1);
                    const r = gameState.rebuys ?? 0;
                    const a = gameState.addonCount ?? 0;
                    const ss = gameState.startStack ?? 0;
                    const as = gameState.addonStack ?? 0;
                    updateGameState({ players: p, totalStack: (p + r) * ss + a * as });
                  }}
                />
                <CounterBlock
                  label="Ребаи"
                  value={gameState.rebuys ?? 0}
                  onAdd={() => {
                    const p = gameState.players ?? 0;
                    const r = (gameState.rebuys ?? 0) + 1;
                    const a = gameState.addonCount ?? 0;
                    const ss = gameState.startStack ?? 0;
                    const as = gameState.addonStack ?? 0;
                    updateGameState({ rebuys: r, totalStack: (p + r) * ss + a * as });
                  }}
                  onRemove={() => {
                    const p = gameState.players ?? 0;
                    const r = Math.max(0, (gameState.rebuys ?? 0) - 1);
                    const a = gameState.addonCount ?? 0;
                    const ss = gameState.startStack ?? 0;
                    const as = gameState.addonStack ?? 0;
                    updateGameState({ rebuys: r, totalStack: (p + r) * ss + a * as });
                  }}
                />
                <CounterBlock
                  label="Аддоны"
                  value={gameState.addonCount ?? 0}
                  onAdd={() => {
                    const p = gameState.players ?? 0;
                    const r = gameState.rebuys ?? 0;
                    const a = (gameState.addonCount ?? 0) + 1;
                    const ss = gameState.startStack ?? 0;
                    const as = gameState.addonStack ?? 0;
                    updateGameState({ addonCount: a, totalStack: (p + r) * ss + a * as });
                  }}
                  onRemove={() => {
                    const p = gameState.players ?? 0;
                    const r = gameState.rebuys ?? 0;
                    const a = Math.max(0, (gameState.addonCount ?? 0) - 1);
                    const ss = gameState.startStack ?? 0;
                    const as = gameState.addonStack ?? 0;
                    updateGameState({ addonCount: a, totalStack: (p + r) * ss + a * as });
                  }}
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
            <div className="flex gap-2 mb-1">
              <button onClick={addBlindLevel} className="admin-btn-primary px-4 py-3 text-sm flex-1">+ Уровень</button>
              <button onClick={addBreak} className="admin-btn-secondary px-4 py-3 text-sm flex-1">+ Перерыв</button>
            </div>
            {blindLevels.map((level, idx) => (
              <BlindRow
                key={level.id}
                level={level}
                onChange={l => updateLevel(idx, l)}
                onDelete={() => deleteLevel(idx)}
                onMoveUp={() => moveLevel(idx, -1)}
                onMoveDown={() => moveLevel(idx, 1)}
                isFirst={idx === 0}
                isLast={idx === blindLevels.length - 1}
              />
            ))}
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
              <div className="text-[#888] text-xs uppercase tracking-widest mb-3">Фон экрана</div>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => updateGameState({ backgroundUrl: null })}
                  className={`admin-btn px-4 py-2 text-sm ${!gameState.backgroundUrl ? 'bg-[#C0392B] text-white' : 'bg-[#2D2D2D] text-[#888]'}`}
                >
                  По умолчанию
                </button>
              </div>
              <input
                className="admin-input"
                placeholder="URL изображения"
                value={gameState.backgroundUrl || ''}
                onChange={e => updateGameState({ backgroundUrl: e.target.value || null })}
              />
              <div className="text-[#555] text-xs mt-1">
                Вставьте ссылку на изображение (jpg, png, webp)
              </div>
            </div>
          </div>
        )}

      </div>
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
function CounterBlock({
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
}
