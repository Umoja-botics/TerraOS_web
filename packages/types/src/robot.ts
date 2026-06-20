import { RobotStatus } from './enums';

export interface Robot {
  id: string;
  name: string;
  type: string;
  status: RobotStatus;
  bridgeUrl: string | null;
  description: string | null;
  lastSeen: string | null;
  config: Record<string, unknown>;
  /** True for demo simulators (no physical hardware). Drives UI badges. */
  isSimulated: boolean;
}

export interface CreateRobotDto {
  name: string;
  type: string;
  bridgeUrl?: string;
  description?: string;
  config?: Record<string, unknown>;
  isSimulated?: boolean;
}

export interface UpdateRobotDto {
  name?: string;
  type?: string;
  bridgeUrl?: string;
  description?: string;
  status?: RobotStatus;
  config?: Record<string, unknown>;
  isSimulated?: boolean;
}
