import { MissionStatus, NavMode, FaultSeverity } from './enums';

// Internally lat/lon; YAML output uses latitude/longitude
export interface Waypoint {
  lat: number;
  lon: number;
  yaw?: number;
}

export interface Path {
  id: string;
  name: string;
  navMode: NavMode;
  waypoints: Waypoint[];
  yamlContent: string;
  createdBy: string;
  createdAt: string;
}

export interface AgentConfig {
  agentId: 'ugv' | 'brouette' | 'drone';
  pathId?: string;
  task?: AgentTask;
}

export interface Mission {
  id: string;
  robotId: string;
  name: string;
  pathId: string | null;
  navMode: string | null;
  agentsJson?: string | null;
  agentConfigs: AgentConfig[] | null;
  status: MissionStatus;
  startedAt: string | null;
  endedAt: string | null;
}

// Faucon report schema
export interface GpsTracePoint {
  lat: number;
  lon: number;
  t: number;
}

export interface MissionEvent {
  t: number;
  type: string;
  msg: string;
}

export interface Fault {
  t: number;
  severity: FaultSeverity;
  source: string;
  msg: string;
}

export interface MissionReport {
  id: string;
  missionId: string;
  reportId: string;
  name: string;
  navMode: string;
  startedAt: string;
  endedAt: string;
  durationS: number;
  status: string;
  totalWp: number;
  completedWp: number;
  distanceM: number;
  agents: string[];
  pathName: string | null;
  gpsTrace: GpsTracePoint[];
  events: MissionEvent[];
  faultHistory: Fault[];
}

export interface CreateMissionDto {
  robotId: string;
  name: string;
  navMode: string;
  agentConfigs: AgentConfig[];
}

// ── Legacy planner types (kept for backward compat) ────────────────
export type AgentId   = 'ugv' | 'brouette' | 'drone';
export type AgentTask = 'follow_path' | 'goto_waypoint' | 'follow_waypoints' | 'inspection';

export interface AgentMissionConfig {
  id:        AgentId;
  task:      AgentTask;
  waypoints: { latitude: number; longitude: number }[];
}

export interface MissionLoadDto {
  name?:             string;
  orchestratorUrl:   string;
  agents:            AgentMissionConfig[];
}
