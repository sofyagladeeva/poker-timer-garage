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
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      const msg = typeof error.message === 'string' ? error.message : '';
      if (msg.includes('floor_notifications') || msg.includes('42P01')) {
        setTableNotExists(true);
      }
      return;
    }

    setTableNotExists(false);
    setNotifications((data ?? []).map(row => rowToNotification(row as RawRow)));
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    void loadNotifications(sessionId);

    const channel = supabase
      .channel(`floor-notifications:${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'floor_notifications' }, () => {
        void loadNotifications(sessionIdRef.current);
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
    const { error } = await supabase.from('floor_notifications').insert({
      session_id: params.sessionId,
      type: params.type,
      table_number: params.tableNumber,
      player_id: params.playerId ?? null,
      player_name: params.playerName ?? null,
      projected_place: params.projectedPlace ?? null,
      bounty: 0,
      status: 'pending',
    });
    return !error;
  }, []);

  const confirmNotification = useCallback(async (id: string, bounty = 0) => {
    const { error } = await supabase
      .from('floor_notifications')
      .update({
        status: 'confirmed',
        bounty,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (!error) {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }
    return !error;
  }, []);

  const pendingCount = notifications.length;

  return { notifications, pendingCount, tableNotExists, createNotification, confirmNotification };
}
