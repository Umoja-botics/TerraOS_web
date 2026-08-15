import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/store/authStore';
import { useFleetStore } from '@/store/fleetStore';
import type {
  RobotStatusEvent,
  RobotTelemetryEvent,
  RobotEventPayload,
  MissionUpdateEvent,
  SystemHealthEvent,
  AgentStatusEvent,
} from '@terra-os/types';

export function useSocket(robotIds: string[]) {
  const token = useAuthStore((s) => s.token);
  const {
    updateStatus,
    updateTelemetry,
    updateMission,
    updateHealth,
    updateAgentStatus,
    addEvent,
    setSocket,
  } = useFleetStore();

  const socketRef     = useRef<Socket | null>(null);
  // Source-of-truth for which IDs we want subscribed.
  // Updated by the subscription effect; consumed by the connect handler.
  const wantedRef     = useRef<Set<string>>(new Set());
  const subscribedRef = useRef<Set<string>>(new Set());

  // ── Socket lifecycle — only on token change ──────────────────────────────
  useEffect(() => {
    if (!token) return;

    const socket = io(
      `${import.meta.env.VITE_SOCKET_URL ?? window.location.origin}/robots`,
      { auth: { token }, reconnectionDelay: 1000, reconnectionDelayMax: 5000 },
    );
    socketRef.current = socket;
    setSocket(socket);

    socket.on('robot:status',    (e: RobotStatusEvent)    => updateStatus(e));
    socket.on('robot:telemetry', (e: RobotTelemetryEvent) => updateTelemetry(e));
    socket.on('mission:update',  (e: MissionUpdateEvent)  => updateMission(e));
    socket.on('system:health',   (e: SystemHealthEvent)   => updateHealth(e));
    socket.on('robot:event',     (e: RobotEventPayload)   => addEvent(e));
    socket.on('agent:status',    (e: AgentStatusEvent)    => updateAgentStatus(e));

    // On every (re)connect, subscribe all wanted IDs
    socket.on('connect', () => {
      subscribedRef.current.clear();
      wantedRef.current.forEach((id) => {
        socket.emit('robot:subscribe', { robotId: id });
        subscribedRef.current.add(id);
      });
    });

    return () => {
      subscribedRef.current.clear();
      socket.disconnect();
      setSocket(null);
      socketRef.current = null;
    };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Subscription management — no socket teardown ─────────────────────────
  useEffect(() => {
    const next = new Set(robotIds);

    // Always sync wantedRef so the connect handler picks up the right IDs
    wantedRef.current = next;

    const socket = socketRef.current;
    if (!socket?.connected) return;

    // Unsubscribe removed IDs
    subscribedRef.current.forEach((id) => {
      if (!next.has(id)) {
        socket.emit('robot:unsubscribe', { robotId: id });
        subscribedRef.current.delete(id);
      }
    });

    // Subscribe new IDs
    next.forEach((id) => {
      if (!subscribedRef.current.has(id)) {
        socket.emit('robot:subscribe', { robotId: id });
        subscribedRef.current.add(id);
      }
    });
  }, [robotIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  return socketRef.current;
}
