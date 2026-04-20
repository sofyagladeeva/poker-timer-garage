interface Props {
  timeLeft: number; // seconds
  isWarning?: boolean; // < 60 sec
  isBreak?: boolean;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function Timer({ timeLeft, isWarning, isBreak }: Props) {
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const display = `${pad(minutes)}:${pad(seconds)}`;

  const colorClass = isBreak
    ? 'text-blue-400 [text-shadow:0_0_30px_rgba(96,165,250,0.8)]'
    : isWarning
    ? 'timer-warning'
    : 'text-white timer-glow';

  return (
    <div className={`font-display tabular-nums leading-none select-none ${colorClass}`}
         style={{ fontSize: 'clamp(80px, 18vw, 200px)', fontFamily: 'Impact, Arial Black, sans-serif' }}>
      {display}
    </div>
  );
}
