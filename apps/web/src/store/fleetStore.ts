import { create } from 'zustand';
import type { Socket } from 'socket.io-client';
import type {
  RobotStatusEvent,
  RobotTelemetryEvent,
  MissionUpdateEvent,
  SystemHealthEvent,
  RobotEventPayload,
  AgentStatusEvent,
} from '@terra-os/types';
import type { RobotLive } from '@/types/fleet';

const EVENT_LOG_MAX = 100;

interface FleetState {
  robots: Record<string, RobotLive>;
  selectedRobotId: string | null;
  socket: Socket | null;
  updateStatus:      (event: RobotStatusEvent) => void;
  updateTelemetry:   (event: RobotTelemetryEvent) => void;
  updateMission:     (event: MissionUpdateEvent) => void;
  updateHealth:      (event: SystemHealthEvent) => void;
  updateAgentStatus: (event: AgentStatusEvent) => void;
  addEvent:          (event: RobotEventPayload) => void;
  selectRobot:       (id: string | null) => void;
  setSocket:         (socket: Socket | null) => void;
}

const empty = (): RobotLive => ({
  status:    null,
  telemetry: null,
  mission:   null,
  health:    null,
  events:    [],
  agents:    {},
  agentTelemetry: {},
});

export const useFleetStore = create<FleetState>()((set) => ({
  robots: {},
  selectedRobotId: null,
  socket: null,

  setSocket: (socket) => set({ socket }),

  updateStatus: (event) =>
    set((s) => {
      const prev = s.robots[event.robotId] ?? empty();
      return {
        robots: {
          ...s.robots,
          [event.robotId]: {
            ...prev,
            status: { ...(prev.status ?? {}), ...event },
          },
        },
      };
    }),

  updateTelemetry: (event) =>
    set((s) => {
      const prev = s.robots[event.robotId] ?? empty();
      const mergeTelemetry = (current: RobotTelemetryEvent | null | undefined): RobotTelemetryEvent => ({
        ...(current ?? {}),
        ...event,
        robotId: event.robotId,
        gps: event.gps ?? current?.gps,
        imu: event.imu ?? current?.imu,
        velocity: event.velocity ?? current?.velocity,
      });
      if (event.agentId && event.agentId !== 'ugv') {
        return {
          robots: {
            ...s.robots,
            [event.robotId]: {
              ...prev,
              agentTelemetry: {
                ...prev.agentTelemetry,
                [event.agentId]: mergeTelemetry(prev.agentTelemetry[event.agentId]),
              },
            },
          },
        };
      }
      return {
        robots: {
          ...s.robots,
          [event.robotId]: { ...prev, telemetry: mergeTelemetry(prev.telemetry) },
        },
      };
    }),

  updateMission: (event) =>
    set((s) => ({
      robots: {
        ...s.robots,
        [event.robotId]: { ...(s.robots[event.robotId] ?? empty()), mission: event },
      },
    })),

  updateHealth: (event) =>
    set((s) => ({
      robots: {
        ...s.robots,
        [event.robotId]: { ...(s.robots[event.robotId] ?? empty()), health: event },
      },
    })),

  updateAgentStatus: (event) =>
    set((s) => {
      const prev = s.robots[event.robotId] ?? empty();
      return {
        robots: {
          ...s.robots,
          [event.robotId]: {
            ...prev,
            agents: { ...prev.agents, [event.agentId]: event },
          },
        },
      };
    }),

  addEvent: (event) =>
    set((s) => {
      const prev = s.robots[event.robotId] ?? empty();
      return {
        robots: {
          ...s.robots,
          [event.robotId]: {
            ...prev,
            events: [event, ...prev.events].slice(0, EVENT_LOG_MAX),
          },
        },
      };
    }),

  selectRobot: (id) => set({ selectedRobotId: id }),
}));
