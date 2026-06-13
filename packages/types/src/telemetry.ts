import { FaultSeverity, SafetyLevel, RobotMode } from './enums';

export interface GpsPosition {
  lat: number;
  lon: number;
  altitude: number;
  fix: number; // 0=no fix, 1=fix, 2=DGPS, -1=invalid
}

export interface ImuData {
  roll: number;
  pitch: number;
  yaw: number;
}

export interface Velocity {
  linear: number;
  angular: number;
}

export interface LiveFault {
  severity: FaultSeverity;
  source: string;
  msg: string;
}

// Socket.IO events — server → client

export interface RobotStatusEvent {
  robotId: string;
  mode: RobotMode;
  safety_level: SafetyLevel;
  battery: number | null; // 0.0 to 1.0
  connected: boolean;
}

export interface RobotTelemetryEvent {
  robotId: string;
  agentId?: 'ugv' | 'brouette' | 'drone';
  gps: GpsPosition;
  imu: ImuData;
  velocity: Velocity;
  /** Current reference path the robot is following (drawn on the map). */
  path?: Array<{ lat: number; lon: number }>;
}

export interface RobotEventPayload {
  robotId: string;
  type: 'mission' | 'wp' | 'ok' | 'warn' | 'alarm' | 'system';
  msg: string;
  timestamp: string; // ISO8601
}

export interface MissionUpdateEvent {
  robotId: string;
  missionId: string;
  state: string;
  currentWp: number;
  totalWp: number;
  navMode: string;
  error: string;
}

export interface SystemHealthEvent {
  robotId: string;
  level: SafetyLevel;
  faults: LiveFault[];
}

// Multi-agent orchestration status (global, not per-robot)
export interface OrchestrationStatus {
  state:            'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'ABORTED';
  ugv_paused:       boolean;
  brouette_active:  boolean;
  drone_active:     boolean;
}

export interface AgentStatusEvent {
  robotId: string;
  agentId: 'ugv' | 'brouette' | 'drone';
  state: 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'ERROR' | 'ABORTED';
  currentWp: number;
  totalWp: number;
  progress: number;
}

// Socket.IO events — client → server
export interface RobotSubscribeDto {
  robotId: string;
}

export interface JoystickCommand {
  robotId: string;
  linear: number;  // -1.0 to 1.0
  angular: number; // -1.0 to 1.0
}

export interface ModeRequestCommand {
  robotId: string;
  type: 'REQUEST_TELEOP' | 'REQUEST_AUTO' | 'REQUEST_AUTONOMOUS' | 'MISSION_LOCK' | 'MISSION_UNLOCK';
}

export interface EstopCommand {
  robotId: string;
  active: boolean;
}

export interface MissionAgentCommand {
  robotId: string;
  agentId: 'ugv' | 'brouette' | 'drone' | 'all';
  command: string;
}
