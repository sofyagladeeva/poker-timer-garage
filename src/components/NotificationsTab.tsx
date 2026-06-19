import { useState } from 'react';
import type { FloorNotification } from '../types.ts';

type Props = {
  notifications: FloorNotification[];
  onConfirm: (id: string, bounty: number) => Promise<boolean>;
};

export function NotificationsTab({ notifications, onConfirm }: Props) {
  const pending = notifications.filter(notification => notification.status === 'pending');
  const archive = notifications
    .filter(notification => notification.status !== 'pending')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (notifications.length === 0) {
    return (
      <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-6 text-center">
        <div className="text-[#444] text-sm">Уведомлений пока нет</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <div>
          <div className="text-white font-black text-base">Ожидают действия</div>
          <div className="text-[#666] text-xs mt-0.5">Новые вызовы флора и неподтверждённые выбывания</div>
        </div>
        {pending.length === 0 ? (
          <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-5 text-[#555] text-sm">
            Нет активных уведомлений
          </div>
        ) : pending.map(n => (
          <NotificationCard key={n.id} notification={n} onConfirm={onConfirm} />
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <div className="text-white font-black text-base">Архив</div>
          <div className="text-[#666] text-xs mt-0.5">Кто, когда и с какого стола звал флора или сообщил о выбывании</div>
        </div>
        {archive.length === 0 ? (
          <div className="bg-[#111] border border-[#2D2D2D] rounded-2xl p-5 text-[#555] text-sm">
            Подтверждённых уведомлений пока нет
          </div>
        ) : archive.map(n => (
          <NotificationCard key={n.id} notification={n} onConfirm={onConfirm} />
        ))}
      </section>
    </div>
  );
}

function NotificationCard({
  notification,
  onConfirm,
}: {
  notification: FloorNotification;
  onConfirm: (id: string, bounty: number) => Promise<boolean>;
}) {
  const [bountyDraft, setBountyDraft] = useState(String(notification.bounty || 0));
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm(notification.id, Math.max(0, parseInt(bountyDraft, 10) || 0));
    } finally {
      setBusy(false);
    }
  };

  const timeLabel = new Date(notification.createdAt).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const dateLabel = new Date(notification.createdAt).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
  });
  const confirmedTimeLabel = notification.confirmedAt
    ? new Date(notification.confirmedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : null;
  const isPending = notification.status === 'pending';

  if (notification.type === 'floor_call') {
    return (
      <div className={`bg-[#111] border rounded-2xl p-4 flex items-center justify-between gap-4 ${
        isPending ? 'border-amber-800/60' : 'border-[#2D2D2D]'
      }`}>
        <div className="flex items-center gap-3">
          <div className="text-2xl">📢</div>
          <div>
            <div className="text-white font-black text-sm">Стол {notification.tableNumber} зовёт флора</div>
            <div className="text-[#666] text-xs mt-0.5">
              {dateLabel}, вызов в {timeLabel}
              {confirmedTimeLabel && <span className="ml-2 text-[#777]">принято в {confirmedTimeLabel}</span>}
            </div>
          </div>
        </div>
        {isPending ? (
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={busy}
            className="admin-btn-secondary px-4 py-2 text-sm whitespace-nowrap shrink-0"
          >
            {busy ? '...' : 'Принято'}
          </button>
        ) : (
          <div className="text-[#666] text-xs uppercase tracking-widest whitespace-nowrap">Архив</div>
        )}
      </div>
    );
  }

  return (
    <div className={`bg-[#111] border rounded-2xl p-4 ${isPending ? 'border-[#C0392B]/50' : 'border-[#2D2D2D]'}`}>
      <div className="flex items-start gap-3">
        <div className="text-2xl mt-0.5">⚠️</div>
        <div className="flex-1 min-w-0">
          <div className="text-white font-black text-sm">
            Стол {notification.tableNumber}: {notification.playerName ?? 'Игрок'} выбыл
          </div>
          <div className="text-[#666] text-xs mt-0.5">
            {dateLabel}, заявлено в {timeLabel}
            {notification.projectedPlace !== null && (
              <span className="ml-2 text-[#888]">Место: #{notification.projectedPlace}</span>
            )}
            {confirmedTimeLabel && <span className="ml-2 text-[#777]">подтверждено в {confirmedTimeLabel}</span>}
            {notification.bounty > 0 && <span className="ml-2 text-[#888]">Bounty: {notification.bounty}</span>}
          </div>

          {isPending && (
            <div className="mt-3 flex items-center gap-3">
              <label className="flex-1 max-w-[140px]">
                <div className="text-[10px] uppercase tracking-[0.14em] text-[#666] mb-1">Bounty</div>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={bountyDraft}
                  onChange={e => setBountyDraft(e.target.value)}
                  className="admin-input !py-2 !text-sm w-full"
                />
              </label>
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={busy}
                className="admin-btn-primary px-4 py-2 text-sm mt-5 whitespace-nowrap"
              >
                {busy ? '...' : 'Подтвердить'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
