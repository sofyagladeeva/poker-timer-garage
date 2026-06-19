import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase.ts';
import type { FloorNotification, FloorNotificationType } from '../types.ts';

type RawRow = {
  id: string;
  session_id: number;
  type: string;
  table_number: number;
  player_id: string | null;
  player_name: string | null;
  projected_place: number | null;
  bounty: number;
  status: string;
  created_at: string;
  confirmed_at: string | null;
};

type StoredNotificationsPayload = {
  version: 1;
  sessionId: number;
  updatedAt: string;
  notifications: FloorNotification[];
};

const FALLBACK_NOTIFICATIONS_PREFIX = '__floor_notifications__';

function fallbackNotificationsKey(sessionId: number) {
  return `${FALLBACK_NOTIFICATIONS_PREFIX}:${sessionId}`;
}

function createFallbackId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `floor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function rowToNotification(row: RawRow): FloorNotification {
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type as FloorNotificationType,
    tableNumber: row.table_number,
    playerId: row.player_id,
    playerName: row.player_name,
    projectedPlace: row.projected_place,
    bounty: row.bounty,
    status: row.status as FloorNotification['status'],
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
  };
}

function normalizeStoredNotification(raw: unknown, sessionId: number): FloorNotification | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Partial<FloorNotification>;
  if (source.type !== 'floor_call' && source.type !== 'bustout') return null;
  if (source.status !== 'pending' && source.status !== 'confirmed') return null;

  return {
    id: typeof source.id === 'string' && source.id ? source.id : createFallbackId(),
    sessionId,
    type: source.type,
    tableNumber: typeof source.tableNumber === 'number' ? Math.max(1, Math.round(source.tableNumber)) : 1,
    playerId: typeof source.playerId === 'string' && source.playerId ? source.playerId : null,
    playerName: typeof source.playerName === 'string' && source.playerName ? source.playerName : null,
    projectedPlace: typeof source.projectedPlace === 'number' ? Math.max(1, Math.round(source.projectedPlace)) : null,
    bounty: typeof source.bounty === 'number' ? Math.max(0, Math.round(source.bounty)) : 0,
    status: source.status,
    createdAt: typeof source.createdAt === 'string' && source.createdAt ? source.createdAt : nowIso(),
    confirmedAt: typeof source.confirmedAt === 'string' && source.confirmedAt ? source.confirmedAt : null,
  };
}

async function loadFallbackNotifications(sessionId: number) {
  const { data, error } = await supabase
    .from('blind_templates')
    .select('levels')
    .eq('id', fallbackNotificationsKey(sessionId))
    .maybeSingle();

  if (error || !data) return [];

  const payload = (data as { levels?: unknown }).levels as Partial<StoredNotificationsPayload> | undefined;
  if (!payload || payload.version !== 1 || payload.sessionId !== sessionId || !Array.isArray(payload.notifications)) {
    return [];
  }

  return payload.notifications
    .map(notification => normalizeStoredNotification(notification, sessionId))
    .filter((notification): notification is FloorNotification => Boolean(notification));
}

async function saveFallbackNotifications(sessionId: number, notifications: FloorNotification[]) {
  const payload: StoredNotificationsPayload = {
    version: 1,
    sessionId,
    updatedAt: nowIso(),
    notifications,
  };
  const { error } = await supabase
    .from('blind_templates')
    .upsert({
      id: fallbackNotificationsKey(sessionId),
      name: `floor_notifications:${sessionId}:${payload.updatedAt}`,
      levels: payload,
    });
  return !error;
}

export function useFloorNotifications(sessionId: number) {
  const [notifications, setNotifications] = useState<FloorNotification[]>([]);
  const [tableNotExists, setTableNotExists] = useState(false);
  const sessionIdRef = useRef(sessionId);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const loadNotifications = useCallback(async (sid: number) => {
    const { data, error } = await supabase
      .from('floor_notifications')
      .select('*')
      .eq('session_id', sid)
      .order('created_at', { ascending: true });

    if (error) {
      const msg = typeof error.message === 'string' ? error.message : '';
      if (msg.includes('floor_notifications') || msg.includes('42P01')) {
        setTableNotExists(true);
      }
      const fallback = await loadFallbackNotifications(sid);
      setNotifications(fallback);
      return;
    }

    setTableNotExists(false);
    const tableNotifications = (data ?? []).map(row => rowToNotification(row as RawRow));
    const fallbackNotifications = await loadFallbackNotifications(sid);
    const byId = new Map<string, FloorNotification>();
    [...tableNotifications, ...fallbackNotifications].forEach(notification => {
      byId.set(notification.id, notification);
    });
    setNotifications(Array.from(byId.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    queueMicrotask(() => {
      void loadNotifications(sessionId);
    });

    const channel = supabase
      .channel(`floor-notifications:${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'floor_notifications' }, () => {
        void loadNotifications(sessionIdRef.current);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blind_templates' }, payload => {
        const row = (payload.new ?? payload.old) as { id?: unknown } | null;
        if (row?.id === fallbackNotificationsKey(sessionIdRef.current)) {
          void loadNotifications(sessionIdRef.current);
        }
      })
      .subscribe();

    const pollInterval = window.setInterval(() => {
      void loadNotifications(sessionIdRef.current);
    }, 5000);

    return () => {
      window.clearInterval(pollInterval);
      void supabase.removeChannel(channel);
    };
  }, [sessionId, loadNotifications]);

  const createNotification = useCallback(async (params: {
    type: FloorNotificationType;
    tableNumber: number;
    sessionId: number;
    playerId?: string | null;
    playerName?: string | null;
    projectedPlace?: number | null;
  }) => {
    const notification: FloorNotification = {
      id: createFallbackId(),
      sessionId: params.sessionId,
      type: params.type,
      tableNumber: params.tableNumber,
      playerId: params.playerId ?? null,
      playerName: params.playerName ?? null,
      projectedPlace: params.projectedPlace ?? null,
      bounty: 0,
      status: 'pending',
      createdAt: nowIso(),
      confirmedAt: null,
    };

    const { error } = await supabase.from('floor_notifications').insert({
      id: notification.id,
      session_id: params.sessionId,
      type: params.type,
      table_number: params.tableNumber,
      player_id: params.playerId ?? null,
      player_name: params.playerName ?? null,
      projected_place: params.projectedPlace ?? null,
      bounty: 0,
      status: 'pending',
    });
    if (!error) {
      setNotifications(prev => [...prev, notification].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      return true;
    }

    const current = await loadFallbackNotifications(params.sessionId);
    const ok = await saveFallbackNotifications(params.sessionId, [...current, notification]);
    if (ok) {
      setNotifications(prev => [...prev, notification].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    }
    return ok;
  }, []);

  const confirmNotification = useCallback(async (id: string, bounty = 0) => {
    const sid = sessionIdRef.current;
    const fallback = await loadFallbackNotifications(sid);
    const fallbackNotification = fallback.find(n => n.id === id);
    if (fallbackNotification) {
      const confirmedAt = nowIso();
      const ok = await saveFallbackNotifications(sid, fallback.map(n => (
        n.id === id ? { ...n, status: 'confirmed', bounty, confirmedAt } : n
      )));
      if (ok) {
        setNotifications(prev => prev.filter(n => n.id !== id));
      }
      return ok;
    }

    const { error } = await supabase
      .from('floor_notifications')
      .update({
        status: 'confirmed',
        bounty,
      confirmed_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (!error) {
      setNotifications(prev => prev.map(n => (
        n.id === id ? { ...n, status: 'confirmed', bounty, confirmedAt: nowIso() } : n
      )));
    }
    return !error;
  }, []);

  const pendingNotifications = notifications.filter(n => n.status === 'pending');
  const pendingCount = pendingNotifications.length;

  return { notifications, pendingNotifications, pendingCount, tableNotExists, createNotification, confirmNotification };
}
