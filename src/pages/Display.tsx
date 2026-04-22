import { useRef, useEffect, useState } from 'react';
import { useGameState } from '../hooks/useGameState';
import { useBotRating } from '../hooks/useBotRating';
import { useNextGame } from '../hooks/useNextGame';
import { getRankPoints, RED_SUITS, SUIT_SYMBOLS } from '../types';
import type { Card } from '../types';

// ─── Audio ─────────────────────────────────────────────────────────────────
let _audioCtx: AudioContext | null = null;
function getCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

/** Сигнал: таймер дошёл до 00:00 — низкий гудок × 3 */
function playTimerEnd() {
  try {
    const ctx = getCtx();
    const now = ctx.currentTime;
    [0, 0.35, 0.7].forEach(t => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.value = 220;
      gain.gain.setValueAtTime(0, now + t);
      gain.gain.linearRampToValueAtTime(0.25, now + t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.28);
      osc.start(now + t);
      osc.stop(now + t + 0.3);
    });
  } catch {}
}

/** Гонг — сигнал смены уровня блайндов */
function playBlindIncrease() {
  try {
    const audio = new Audio(import.meta.env.BASE_URL + 'gong.mp3');
    audio.play().catch(() => {});
  } catch {}
}

function pad(n: number) { return String(n).padStart(2, '0'); }
function fmtCountdown(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}
function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return String(n);
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

const MEDAL_IMGS = [1, 2, 3];

function FullscreenButton() {
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggle = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };
  return (
    <button
      onClick={toggle}
      title={isFs ? 'Выйти из полного экрана' : 'На весь экран'}
      style={{
        position: 'fixed', top: 8, left: 8, zIndex: 9999,
        background: 'rgba(255,255,255,0.07)', border: 'none',
        borderRadius: 6, padding: '4px 6px', cursor: 'pointer',
        color: '#444', fontSize: 16, lineHeight: 1,
      }}
    >
      {isFs ? '✕' : '⛶'}
    </button>
  );
}

const W = 1280, H = 680;

function useScale() {
  const [s, setS] = useState({ k: 1, x: 0, y: 0 });
  useEffect(() => {
    const upd = () => {
      const k = Math.min(window.innerWidth / W, window.innerHeight / H);
      setS({ k, x: (window.innerWidth - W * k) / 2, y: (window.innerHeight - H * k) / 2 });
    };
    upd();
    window.addEventListener('resize', upd);
    return () => window.removeEventListener('resize', upd);
  }, []);
  return s;
}

export function Display() {
  const { gameState, blindLevels, combinations } = useGameState();
  const { players: ratingPlayers } = useBotRating();
  const nextGame = useNextGame();
  const { k, x, y } = useScale();

  // Активируем AudioContext при первом взаимодействии (политика браузера)
  useEffect(() => {
    const resume = () => { try { getCtx(); } catch {} };
    document.addEventListener('click', resume, { once: true });
    document.addEventListener('keydown', resume, { once: true });
    return () => {
      document.removeEventListener('click', resume);
      document.removeEventListener('keydown', resume);
    };
  }, []);

  // Звук при достижении 00:00
  const prevTimeRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevTimeRef.current !== null && prevTimeRef.current > 0 && gameState.timeLeft === 0) {
      playTimerEnd();
    }
    prevTimeRef.current = gameState.timeLeft;
  }, [gameState.timeLeft]);

  // Звук при смене уровня (не при первом рендере)
  const prevLevelRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevLevelRef.current !== null && prevLevelRef.current !== gameState.currentLevelIndex) {
      playBlindIncrease();
    }
    prevLevelRef.current = gameState.currentLevelIndex;
  }, [gameState.currentLevelIndex]);

  const currentLevel = blindLevels[gameState.currentLevelIndex] ?? null;
  const nextLevel    = blindLevels[gameState.currentLevelIndex + 1] ?? null;

  const isBreak   = gameState.status === 'break' || currentLevel?.isBreak;
  const isWarning = gameState.timeLeft <= 60 && gameState.status === 'running';

  const minutes = Math.floor(gameState.timeLeft / 60);
  const seconds = gameState.timeLeft % 60;

  const currentBB    = currentLevel?.bb ?? 0;
  const activePlayers = Math.max(0, (gameState.players ?? 0) - (gameState.outs ?? 0));
  const avgStack     = activePlayers > 0 ? Math.round(gameState.totalStack / activePlayers) : 0;
  const avgInBB      = currentBB > 0 && avgStack > 0 ? Math.round(avgStack / currentBB) : 0;

  const rankPoints   = getRankPoints(gameState.players);
  const top3         = ratingPlayers.slice(0, 3);
  const activeCombos = combinations.filter(c => c.enabled);

  // Сколько секунд до следующего перерыва (живой отсчёт)
  const nextBreakIdx = !isBreak
    ? blindLevels.findIndex((l, i) => i > gameState.currentLevelIndex && l.isBreak)
    : -1;
  const levelsUntilBreak = nextBreakIdx > 0 ? nextBreakIdx - gameState.currentLevelIndex : null;
  const secondsUntilBreak = nextBreakIdx > 0
    ? gameState.timeLeft + blindLevels.slice(gameState.currentLevelIndex + 1, nextBreakIdx).reduce((s, l) => s + l.duration, 0)
    : null;

  // Таймер всегда красный; при <60 сек — пульсирует, но цвет не меняется
  const timerColor = isWarning ? '#E31E24' : '#FFFFFF';
  const timerGlow  = isWarning
    ? '0 0 40px rgba(227,30,36,1), 0 0 120px rgba(227,30,36,0.6)'
    : '0 0 40px rgba(255,255,255,0.15)';

  const bgStyle = gameState.backgroundUrl
    ? {
        backgroundImage: `url("${gameState.backgroundUrl}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }
    : {};

  /* ══════════════ RATING MODE ══════════════ */
  if (gameState.showRating) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#0D0D0D', overflow: 'hidden', ...bgStyle }}>
        {gameState.backgroundUrl && <div className="absolute inset-0 bg-black/75 z-0" />}
        <FullscreenButton />
        <div style={{ position: 'absolute', width: W, height: H, transform: `translate(${x}px,${y}px) scale(${k})`, transformOrigin: 'top left' }}
             className="flex flex-col items-center justify-center gap-8 px-12">
          <div className="text-[#444] uppercase tracking-[0.4em] text-sm">
            Рейтинг · {new Date().toLocaleString('ru-RU', { month: 'long', year: 'numeric' })}
          </div>
          <div className="flex items-end justify-center gap-6 w-full max-w-4xl">
            {top3[1] && <RatingCard player={top3[1]} medal={2} big={false} />}
            {top3[0] && <RatingCard player={top3[0]} medal={1} big />}
            {top3[2] && <RatingCard player={top3[2]} medal={3} big={false} />}
          </div>
          <div className="flex gap-4 flex-wrap justify-center">
            {ratingPlayers.slice(3, 7).map((p, i) => (
              <div key={p.telegram_id}
                   className="bg-[#141414] border border-[#222] rounded-xl px-6 py-3 flex items-center gap-4 min-w-[220px]">
                <span className="text-[#444] font-bold w-5">{i + 4}</span>
                <span className="text-white font-bold flex-1 truncate">{p.name}</span>
                <span className="text-[#E31E24] font-black text-lg">{p.points.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ══════════════ GAME MODE ══════════════ */
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0D0D0D', overflow: 'hidden', ...bgStyle }}
         className="select-none">
      {gameState.backgroundUrl && <div className="absolute inset-0 bg-black/75 z-0" />}
      <FullscreenButton />

      <div style={{ position: 'absolute', width: W, height: H, transform: `translate(${x}px,${y}px) scale(${k})`, transformOrigin: 'top left' }}
           className="flex flex-col">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-center gap-5 px-8 py-2 border-b border-[#181818] flex-shrink-0">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="Garage Game Club"
            style={{ height: '44px', width: 'auto' }}
            className="opacity-90 select-none pointer-events-none"
          />
          {gameState.tournamentTitle && (
            <>
              <span className="text-[#2A2A2A] text-3xl font-thin">·</span>
              <span className="text-[#E31E24] font-black text-xl uppercase tracking-widest">
                {gameState.tournamentTitle}
              </span>
            </>
          )}
        </div>

        {/* ── 3 columns ──────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0">

          {/* ═══ LEFT: stats + combinations ═══ */}
          <div className="flex flex-col w-[30%] border-r border-[#181818] px-5 py-5 gap-4">

            {/* Stats */}
            <div className="flex flex-col gap-3">
              <ColLabel>Статистика турнира</ColLabel>
              <StatRow
                label="Игроки"
                value={gameState.players > 0
                  ? `${activePlayers} / ${gameState.players}`
                  : '—'}
              />
              <StatRow label="Фишек в игре" value={gameState.totalStack > 0 ? fmt(gameState.totalStack) : '—'} />
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[#666] text-lg flex-shrink-0">Средний стек</span>
                <span className="flex items-baseline gap-2">
                  <span className="text-white font-black text-4xl">{avgStack > 0 ? fmt(avgStack) : '—'}</span>
                  {avgInBB > 0 && (
                    <>
                      <span className="text-[#E31E24] font-black text-2xl">{avgInBB}</span>
                      <span className="text-[#555] text-sm">BB</span>
                    </>
                  )}
                </span>
              </div>
            </div>

            {/* Divider */}
            <div className="h-px bg-[#181818]" />

            {/* Combinations — занимают оставшееся место */}
            <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto">
              {activeCombos.length > 0
                ? <>
                    <ColLabel>Играющие комбинации</ColLabel>
                    {activeCombos.map(combo => (
                      <div key={combo.id} className="bg-[#111] border border-[#1E1E1E] rounded-xl p-3">
                        {/* Карты — фиксированный размер, пропорции покерной карты */}
                        <div className="flex flex-nowrap gap-2 mb-3">
                          {combo.cards.map((card, ci) => (
                            <ComboCard key={ci} card={card} />
                          ))}
                        </div>
                        {/* Описание — одна строка */}
                        <div className="text-[#999] text-sm leading-snug line-clamp-2">{combo.description}</div>
                      </div>
                    ))}
                  </>
                : <div className="text-[#252525] text-sm">Нет активных комбинаций</div>
              }
            </div>
          </div>

          {/* ═══ CENTER: timer + blinds ═══ */}
          <div className="flex flex-col items-center flex-1 px-4 overflow-hidden">

          <div className="flex flex-col items-center justify-center flex-1 gap-6">
            {/* Номер уровня — над таймером */}
            {!isBreak && currentLevel && !currentLevel.isBreak && (
              <div
                className="uppercase tracking-[0.4em] text-center"
                style={{ color: '#444', fontSize: '18px' }}
              >
                Уровень {currentLevel.level}
              </div>
            )}

            {/* ПЕРЕРЫВ — крупно над таймером во время перерыва */}
            {isBreak && (
              <div
                className="break-pulse text-center tracking-[0.3em]"
                style={{
                  fontFamily: 'Impact, Arial Black, sans-serif',
                  fontSize: '60px',
                  color: '#FFFFFF',
                  textShadow: '0 0 40px rgba(255,255,255,0.3)',
                }}
              >
                {currentLevel?.breakLabel || 'ПЕРЕРЫВ'}
              </div>
            )}

            {/* Timer */}
            <div
              className={`font-black tabular-nums leading-none${isWarning ? ' break-pulse' : ''}`}
              style={{
                fontSize: '210px',
                fontFamily: 'Impact, Arial Black, sans-serif',
                color: timerColor,
                textShadow: timerGlow,
              }}
            >
              {pad(minutes)}:{pad(seconds)}
            </div>

            {/* Current blinds */}
            {currentLevel && !currentLevel.isBreak && (
              <div className="flex items-center gap-6">
                <BlindBox label="SB" value={fmt(currentLevel.sb)} />
                <span className="text-[#202020] text-5xl font-thin">/</span>
                <BlindBox label="BB" value={fmt(currentLevel.bb)} />
                {currentLevel.ante > 0 && (
                  <>
                    <span className="text-[#202020] text-3xl">+</span>
                    <BlindBox label="АНТЕ" value={fmt(currentLevel.ante)} accent />
                  </>
                )}
              </div>
            )}

            {/* Next level */}
            {nextLevel && (
              <div className="flex items-center gap-4 opacity-55">
                <span className="text-[#666] text-base uppercase tracking-widest whitespace-nowrap">Далее:</span>
                {nextLevel.isBreak
                  ? <span
                      className="font-black text-2xl tracking-widest"
                      style={{ fontFamily: 'Impact, Arial Black, sans-serif', color: 'white' }}
                    >
                      {nextLevel.breakLabel || 'ПЕРЕРЫВ'}
                    </span>
                  : <span className="text-white font-black text-2xl">
                      {fmt(nextLevel.sb)} / {fmt(nextLevel.bb)}
                      {nextLevel.ante > 0 && (
                        <span className="text-[#E31E24]"> + {fmt(nextLevel.ante)}</span>
                      )}
                    </span>
                }
              </div>
            )}

          </div>

            {/* Живой отсчёт до перерыва — внизу */}
            {!isBreak && secondsUntilBreak !== null && levelsUntilBreak !== null && levelsUntilBreak > 1 && (
              <div className="pb-4 text-center">
                <div className="uppercase tracking-[0.25em] mb-1 font-light" style={{ color: '#E31E24', fontSize: '13px' }}>до перерыва</div>
                <div
                  className="tabular-nums"
                  style={{
                    fontFamily: 'Impact, Arial Black, sans-serif',
                    fontSize: '44px',
                    color: '#666',
                  }}
                >
                  {fmtCountdown(secondsUntilBreak)}
                </div>
              </div>
            )}
          </div>

          {/* ═══ RIGHT: prize points + top3 + next game ═══ */}
          <div className="flex flex-col w-[24%] border-l border-[#181818] px-5 py-5 gap-4">

            {/* Prize rank points */}
            <div>
              <ColLabel>Очки турнира{gameState.players > 0 ? ` · ${gameState.players} игроков` : ''}</ColLabel>
              <div className="grid grid-cols-3 gap-2 mt-3">
                {rankPoints.length > 0
                  ? rankPoints.slice(0, 9).map((pts, i) => (
                      <div key={i} className="bg-[#111] rounded-lg py-2 text-center">
                        <div className="text-[#444] text-xs">{i + 1} место</div>
                        <div className="text-[#E31E24] font-black text-xl leading-tight">{pts.toFixed(1)}</div>
                      </div>
                    ))
                  : <span className="text-[#252525] text-sm col-span-3">Укажите кол-во игроков</span>
                }
              </div>
            </div>

            <div className="h-px bg-[#181818]" />

            {/* Top-3 */}
            <div className="flex flex-col gap-2">
              <ColLabel>Топ-3 месяца</ColLabel>
              {top3.length === 0
                ? <div className="text-[#252525] text-sm">Загрузка...</div>
                : top3.map((p, i) => (
                    <div key={p.telegram_id}
                         className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
                           i === 0
                             ? 'bg-[#160800] border border-[#E31E24]/25'
                             : 'bg-[#111] border border-[#1A1A1A]'
                         }`}>
                      <img src={`${import.meta.env.BASE_URL}medal-${MEDAL_IMGS[i]}.png`} style={{ width: 28, height: 28, objectFit: 'contain' }} alt="" />
                      <span className="text-white font-bold text-base flex-1 truncate">{p.name}</span>
                      <span className={`font-black text-2xl ${i === 0 ? 'text-[#E31E24]' : 'text-[#555]'}`}>
                        {p.points.toFixed(1)}
                      </span>
                    </div>
                  ))
              }
            </div>

            <div className="h-px bg-[#181818]" />

            {/* Next tournament */}
            <div className="flex flex-col">
              <ColLabel>Следующий турнир</ColLabel>
              {nextGame ? (
                <div className="mt-2 bg-[#111] border border-[#1A1A1A] rounded-xl p-3">
                  <div className="text-white font-black text-xl uppercase leading-tight">{nextGame.title}</div>
                  <div className="text-[#555] text-sm mt-1">{fmtDate(nextGame.date)} · {fmtTime(nextGame.date)}</div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[#E31E24] font-bold text-base">{nextGame.confirmed}</span>
                    <span className="text-[#333] text-sm">/ {nextGame.max_players} мест</span>
                    {nextGame.seats_left > 0 &&
                      <span className="text-green-500 text-sm ml-auto">● есть места</span>}
                  </div>
                </div>
              ) : (
                <div className="text-[#252525] text-sm mt-2">Нет данных</div>
              )}
            </div>

          </div>
        </div>
        {/* нижней полосы нет */}
      </div>
    </div>
  );
}

/* ─── Sub-components ──────────────────────────────────────────────────────── */
function ColLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[#555] text-sm uppercase tracking-widest">{children}</div>;
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[#666] text-lg">{label}</span>
      <span className="text-white font-black text-4xl">{value}</span>
    </div>
  );
}

/* Карта — фиксированные пропорции покерной карты (2.5:3.5), масштаб от высоты экрана */
function ComboCard({ card }: { card: Card }) {
  const isAny = card.suit === 'any';
  const isRed = !isAny && RED_SUITS.includes(card.suit);
  const cardStyle = {
    height: '90px',
    width: '65px',
  };
  return (
    <div
      className={`flex-shrink-0 flex flex-col items-center justify-center bg-white rounded-xl font-bold shadow-lg ${isRed ? 'text-[#C0392B]' : 'text-[#0A0A0A]'}`}
      style={cardStyle}
    >
      <span style={{ fontSize: '26px', lineHeight: 1.1 }}>{card.rank}</span>

      {isAny ? (
        /* Сетка 2×2 всех мастей */
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '1px',
          fontSize: '18px',
          lineHeight: 1.1,
          marginTop: 2,
        }}>
          <span style={{ color: '#111' }}>♠</span>
          <span style={{ color: '#C0392B' }}>♥</span>
          <span style={{ color: '#C0392B' }}>♦</span>
          <span style={{ color: '#111' }}>♣</span>
        </div>
      ) : (
        <span style={{ fontSize: '34px', lineHeight: 1.1 }}>{SUIT_SYMBOLS[card.suit]}</span>
      )}
    </div>
  );
}

function BlindBox({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="text-center">
      <div className="text-[#333] text-xs uppercase tracking-widest mb-1">{label}</div>
      <div
        className={`font-black ${accent ? 'text-[#E31E24]' : 'text-white'}`}
        style={{ fontSize: '60px', fontFamily: 'Impact, Arial Black, sans-serif' }}
      >
        {value}
      </div>
    </div>
  );
}

function RatingCard({ player, medal, big }: {
  player: { name: string; points: number; games: number };
  medal: number;
  big: boolean;
}) {
  return (
    <div
      className={`flex-1 bg-[#141414] rounded-2xl p-6 text-center ${big ? 'border-2 border-[#E31E24]' : 'border border-[#222]'}`}
      style={big ? { boxShadow: '0 0 40px rgba(227,30,36,0.2)' } : {}}
    >
      <img src={`${import.meta.env.BASE_URL}medal-${medal}.png`} style={{ width: big ? 80 : 60, height: big ? 80 : 60, objectFit: 'contain', margin: '0 auto' }} alt="" />
      <div className={`text-white font-black mt-2 ${big ? 'text-3xl' : 'text-xl'}`}>{player.name}</div>
      <div className={`text-[#E31E24] font-black mt-1 ${big ? 'text-5xl' : 'text-3xl'}`}>{player.points.toFixed(1)}</div>
      <div className="text-[#383838] text-sm mt-1">{player.games} игр</div>
    </div>
  );
}
