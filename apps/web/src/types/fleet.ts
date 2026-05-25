import type {
  RobotStatusEvent,
  RobotTelemetryEvent,
  MissionUpdateEvent,
  SystemHealthEvent,
  RobotEventPayload,
  AgentStatusEvent,
} from '@terra-os/types';

export interface RobotLive {
  status:    RobotStatusEvent | null;
  telemetry: RobotTelemetryEvent | null;
  mission:   MissionUpdateEvent | null;
  health:    SystemHealthEvent | null;
  events:    RobotEventPayload[];
  agents:    Record<string, AgentStatusEvent>;
  agentTelemetry: Record<string, RobotTelemetryEvent>;
}
