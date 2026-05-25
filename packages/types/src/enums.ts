export enum Role {
  ADMIN = 'ADMIN',
  OPERATOR = 'OPERATOR',
  VIEWER = 'VIEWER',
}

export enum RobotStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  ERROR = 'ERROR',
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
}

export enum RobotMode {
  STANDBY = 'STANDBY',
  TELEOP = 'TELEOP',
  AUTONOMOUS = 'AUTONOMOUS',
  ESTOP = 'ESTOP',
  // Legacy aliases kept so older persisted/status payloads do not break the UI.
  MISSION = 'MISSION',
  EMERGENCY_STOP = 'EMERGENCY_STOP',
  MANUAL = 'MANUAL',
  ERROR = 'ERROR',
}

export enum SafetyLevel {
  OK = 'OK',
  NOTIFICATION = 'NOTIFICATION',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
}

export enum FaultSeverity {
  NOTIFICATION = 'NOTIFICATION',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
}

export enum MissionStatus {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  ABORTED = 'ABORTED',
  ERROR = 'ERROR',
  FAILED = 'FAILED',
}

export enum NavMode {
  FOLLOW_WAYPOINTS = 'FOLLOW_WAYPOINTS',
  GOTO_WAYPOINT = 'GOTO_WAYPOINT',
  PATROL = 'PATROL',
  RETURN_HOME = 'RETURN_HOME',
  MANUAL = 'MANUAL',
}
