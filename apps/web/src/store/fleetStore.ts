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

export const SIM_ROBOT_ID = '00000000-0000-0000-0000-000000000001';

interface FleetState {
  robots: Record<string, RobotLive>;
  selectedRobotId: string | null;
  socket: Socket | null;
  simMode: boolean;
  updateStatus:      (event: RobotStatusEvent) => void;
  updateTelemetry:   (event: RobotTelemetryEvent) => void;
  updateMission:     (event: MissionUpdateEvent) => void;
  updateHealth:      (event: SystemHealthEvent) => void;
  updateAgentStatus: (event: AgentStatusEvent) => void;
  addEvent:          (event: RobotEventPayload) => void;
  selectRobot:       (id: string | null) => void;
  setSocket:         (socket: Socket | null) => void;
  toggleSimMode:     () => void;
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

export const useFleetStore = create<FleetState>()((set, get) => ({
  robots: {},
  selectedRobotId: null,
  socket: null,
  simMode: false,

  setSocket: (socket) => set({ socket }),

  toggleSimMode: () => {
    const { simMode, selectedRobotId, socket } = get();
    const next = !simMode;
    if (next) {
      // Entering sim mode: subscribe to sim robot room
      if (socket) socket.emit('robot:subscribe', { robotId: SIM_ROBOT_ID });
      set({ simMode: true, selectedRobotId: SIM_ROBOT_ID });
    } else {
      // Leaving sim mode: unsubscribe and clear selection if it was the sim
      if (socket) socket.emit('robot:unsubscribe', { robotId: SIM_ROBOT_ID });
      set({ simMode: false, selectedRobotId: selectedRobotId === SIM_ROBOT_ID ? null : selectedRobotId });
    }
  },

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
        path: event.path ?? current?.path,
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
