import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import type {
  RobotStatusEvent,
  RobotTelemetryEvent,
  RobotEventPayload,
  MissionUpdateEvent,
  SystemHealthEvent,
  RobotSubscribeDto,
  JoystickCommand,
  OrchestrationStatus,
  AgentStatusEvent,
  ModeRequestCommand,
  EstopCommand,
  MissionAgentCommand,
} from '@terra-os/types';
import { Role } from '@terra-os/types';
import { RobotsService } from '../robots/robots.service';
import { UsersService } from '../users/users.service';

@WebSocketGateway({
  namespace: '/robots',
  cors: {
    // Use a function so process.env.WEB_URL is read at request time (after ConfigModule loads .env),
    // not at class-decoration time when the env file hasn't been parsed yet.
    origin: (origin: string, cb: (err: Error | null, allow?: boolean) => void) => {
      const allowed = process.env.WEB_URL ?? 'http://localhost:3001';
      cb(null, !origin || origin === allowed);
    },
    credentials: true,
  },
})
export class TelemetryGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TelemetryGateway.name);
  private readonly robotModes = new Map<string, string>();
  private readonly missionStates = new Map<string, string>();
  private readonly connectedStates = new Map<string, boolean>();
  private readonly missionWaypoints = new Map<string, number>();
  private readonly healthFaults = new Map<string, Map<string, string>>();
  private readonly agentStates = new Map<string, string>();
  private readonly agentWaypoints = new Map<string, number>();

  constructor(
    private robotsService: RobotsService,
    private jwtService: JwtService,
    private usersService: UsersService,
  ) {}

  async handleConnection(client: Socket) {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(token);
      const user = await this.usersService.findById(payload.sub);
      if (!user) throw new Error('User not found');
      client.data.user = { id: user.id, role: user.role };
      this.logger.log(`[WS] connected: ${client.id}`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`[WS] disconnected: ${client.id}`);
  }

  @SubscribeMessage('robot:subscribe')
  handleSubscribe(@MessageBody() dto: RobotSubscribeDto, @ConnectedSocket() client: Socket) {
    void client.join(`robot:${dto.robotId}`);
  }

  @SubscribeMessage('robot:unsubscribe')
  handleUnsubscribe(@MessageBody() dto: RobotSubscribeDto, @ConnectedSocket() client: Socket) {
    void client.leave(`robot:${dto.robotId}`);
  }

  @SubscribeMessage('robot:joystick')
  async handleJoystick(@MessageBody() cmd: JoystickCommand, @ConnectedSocket() client: Socket) {
    return this.handleTeleop(cmd, client);
  }

  @SubscribeMessage('robot:teleop')
  async handleTeleop(@MessageBody() cmd: JoystickCommand, @ConnectedSocket() client: Socket) {
    if (!(await this.canCommand(client))) return { ok: false, error: 'forbidden' };
    const base = await this.getBridgeBase(cmd.robotId);
    if (!base) return { ok: false, error: 'bridge_unavailable' };
    const linear = Number(cmd.linear);
    const angular = Number(cmd.angular);
    if (!Number.isFinite(linear) || !Number.isFinite(angular)) {
      this.logger.warn(`Invalid joystick payload from ${client.id}`);
      return { ok: false, error: 'invalid_payload' };
    }
    const zeroVelocity = Math.abs(linear) < 1e-6 && Math.abs(angular) < 1e-6;
    if (!zeroVelocity && this.isTeleopBlocked(cmd.robotId)) return { ok: false, error: 'teleop_blocked' };
    return this.postToBridge(base, '/commands/teleop', { linear, angular });
  }

  @SubscribeMessage('robot:estop')
  async handleEstop(@MessageBody() cmd: EstopCommand, @ConnectedSocket() client: Socket) {
    if (!(await this.canCommand(client))) return { ok: false, error: 'forbidden' };
    const base = await this.getBridgeBase(cmd.robotId);
    if (!base) return { ok: false, error: 'bridge_unavailable' };
    return this.postToBridge(base, '/commands/estop', { active: cmd.active });
  }

  @SubscribeMessage('robot:mode_request')
  async handleModeRequest(@MessageBody() cmd: ModeRequestCommand, @ConnectedSocket() client: Socket) {
    if (!(await this.canCommand(client))) return { ok: false, error: 'forbidden' };
    if (cmd.type === 'REQUEST_TELEOP' && this.isTeleopBlocked(cmd.robotId)) {
      return { ok: false, error: 'teleop_blocked' };
    }
    const base = await this.getBridgeBase(cmd.robotId);
    if (!base) return { ok: false, error: 'bridge_unavailable' };
    return this.postToBridge(base, '/commands/mode', { type: cmd.type });
  }

  @SubscribeMessage('robot:set_mode')
  async handleSetMode(@MessageBody() cmd: { robotId: string; mode: string }, @ConnectedSocket() client: Socket) {
    if (!(await this.canCommand(client))) return { ok: false, error: 'forbidden' };
    const base = await this.getBridgeBase(cmd.robotId);
    if (!base) return { ok: false, error: 'bridge_unavailable' };
    return this.postToBridge(base, '/commands/set_mode', { mode: cmd.mode });
  }

  @SubscribeMessage('robot:mission_command')
  async handleMissionCommand(@MessageBody() cmd: MissionAgentCommand, @ConnectedSocket() client: Socket) {
    if (!(await this.canCommand(client))) return { ok: false, error: 'forbidden' };
    const base = await this.getBridgeBase(cmd.robotId);
    if (!base) return { ok: false, error: 'bridge_unavailable' };
    return this.postToBridge(base, '/commands/mission/command', {
      agent_id: cmd.agentId,
      command: cmd.command,
    });
  }

  @SubscribeMessage('robot:orchestration_load')
  async handleOrchestrationLoad(
    @MessageBody() cmd: { robotId: string; profile: Record<string, unknown> },
    @ConnectedSocket() client: Socket,
  ) {
    if (!(await this.canCommand(client))) return { ok: false, error: 'forbidden' };
    const base = await this.getBridgeBase(cmd.robotId);
    if (!base) return { ok: false, error: 'bridge_unavailable' };
    return this.postToBridge(base, '/commands/orchestration/load', {
      mission_id: cmd.profile['mission_id'] ?? 'live',
      name: cmd.profile['name'] ?? 'Live Mission',
      agents: cmd.profile['agents'] ?? [],
    });
  }

  @SubscribeMessage('robot:orchestration_command')
  async handleOrchestrationCommand(
    @MessageBody() cmd: { robotId: string; command: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!(await this.canCommand(client))) return { ok: false, error: 'forbidden' };
    const base = await this.getBridgeBase(cmd.robotId);
    if (!base) return { ok: false, error: 'bridge_unavailable' };
    return this.postToBridge(base, '/commands/orchestration/command', { command: cmd.command });
  }

  // ── Broadcast helpers ──────────────────────────────────────────────────────

  broadcastStatus(event: RobotStatusEvent) {
    const previousMode = this.robotModes.get(event.robotId);
    const nextMode = event.mode ? String(event.mode).toUpperCase() : undefined;
    if (nextMode) {
      this.robotModes.set(event.robotId, nextMode);
    }
    this.server.to(`robot:${event.robotId}`).emit('robot:status', event);

    const previousConnected = this.connectedStates.get(event.robotId);
    if (typeof event.connected === 'boolean' && previousConnected !== undefined && previousConnected !== event.connected) {
      this.emitRobotEvent(
        event.robotId,
        event.connected ? 'ok' : 'alarm',
        event.connected ? 'ROS bridge connecté' : 'ROS bridge déconnecté',
      );
    }
    if (typeof event.connected === 'boolean') {
      this.connectedStates.set(event.robotId, event.connected);
    }

    if (previousMode && nextMode && nextMode !== previousMode) {
      this.emitRobotEvent(
        event.robotId,
        nextMode === 'ESTOP' || nextMode === 'EMERGENCY_STOP' ? 'alarm' : 'system',
        `Mode ${nextMode}`,
      );
    }
  }

  broadcastTelemetry(event: RobotTelemetryEvent) {
    this.server.to(`robot:${event.robotId}`).emit('robot:telemetry', event);
  }

  broadcastEvent(event: RobotEventPayload) {
    this.server.to(`robot:${event.robotId}`).emit('robot:event', event);
  }

  broadcastMissionUpdate(event: MissionUpdateEvent) {
    const state = String(event.state).toUpperCase();
    const previousState = this.missionStates.get(event.robotId);
    this.missionStates.set(event.robotId, state);
    this.server.to(`robot:${event.robotId}`).emit('mission:update', event);
    this.emitMissionEvents(event, previousState);
  }

  broadcastHealth(event: SystemHealthEvent) {
    this.server.to(`robot:${event.robotId}`).emit('system:health', event);
    this.emitHealthEvents(event);
  }

  broadcastAgentStatus(event: AgentStatusEvent) {
    this.server.to(`robot:${event.robotId}`).emit('agent:status', event);
    this.emitAgentEvents(event);
  }

  broadcastOrchestration(status: OrchestrationStatus) {
    this.server.emit('orchestration:status', status);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async getBridgeBase(robotId: string): Promise<string | null> {
    try {
      const robot = await this.robotsService.findById(robotId);
      if (!robot.bridgeUrl) return null;
      return robot.bridgeUrl.replace('://localhost', '://127.0.0.1').replace(/\/+$/, '');
    } catch {
      return null;
    }
  }

  private emitMissionEvents(event: MissionUpdateEvent, previousState: string | undefined) {
    const state = String(event.state).toUpperCase();
    if (state !== previousState) {
      const first = previousState === undefined;
      const suffix = event.missionId ? ` — ${event.missionId}` : '';
      const label: string | null = ({
        RUNNING: `Mission démarrée${suffix}`,
        PAUSED: 'Mission en pause',
        COMPLETED: `Mission complétée${suffix}`,
        ABORTED: 'Mission annulée',
        ERROR: `Erreur mission${event.error ? ` : ${event.error}` : ''}`,
        READY: `Chemin chargé${suffix}`,
        IDLE: first ? null : 'Mission en attente',
      } as Record<string, string | null>)[state] ?? null;

      if (label) {
        const type: RobotEventPayload['type'] =
          state === 'ERROR' || state === 'ABORTED' ? 'alarm'
          : state === 'COMPLETED' ? 'ok'
          : state === 'PAUSED' ? 'warn'
          : state === 'RUNNING' ? 'mission'
          : 'system';
        this.emitRobotEvent(event.robotId, type, label);
      }
    }

    const waypoint = Number(event.currentWp);
    const total = Number(event.totalWp);
    const previousWaypoint = this.missionWaypoints.get(event.robotId);
    if (Number.isFinite(waypoint)) {
      this.missionWaypoints.set(event.robotId, waypoint);
    }
    if (
      state === 'RUNNING' &&
      Number.isFinite(waypoint) &&
      Number.isFinite(total) &&
      waypoint > 0 &&
      total > 0 &&
      waypoint !== previousWaypoint
    ) {
      this.emitRobotEvent(event.robotId, 'wp', `UGV WP ${waypoint}/${total}`);
    }
  }

  private emitHealthEvents(event: SystemHealthEvent) {
    const previous = this.healthFaults.get(event.robotId) ?? new Map<string, string>();
    const next = new Map<string, string>();

    for (const fault of event.faults ?? []) {
      const source = fault.source || 'system';
      next.set(source, fault.msg ?? '');
      if (!previous.has(source)) {
        const type: RobotEventPayload['type'] =
          fault.severity === 'ERROR' ? 'alarm'
          : fault.severity === 'WARNING' ? 'warn'
          : 'system';
        this.emitRobotEvent(event.robotId, type, `${source} — ${fault.msg ?? ''}`);
      }
    }

    for (const source of previous.keys()) {
      if (!next.has(source)) {
        this.emitRobotEvent(event.robotId, 'ok', `Résolu : ${source}`);
      }
    }

    this.healthFaults.set(event.robotId, next);
  }

  private emitAgentEvents(event: AgentStatusEvent) {
    const key = `${event.robotId}:${event.agentId}`;
    const state = String(event.state).toUpperCase();
    const previousState = this.agentStates.get(key);
    this.agentStates.set(key, state);

    if (state !== previousState && (previousState !== undefined || state !== 'IDLE')) {
      const label = this.agentLabel(event.agentId);
      const type: RobotEventPayload['type'] =
        state === 'ERROR' || state === 'ABORTED' ? 'alarm'
        : state === 'COMPLETED' ? 'ok'
        : state === 'PAUSED' ? 'warn'
        : state === 'RUNNING' ? 'mission'
        : 'system';
      this.emitRobotEvent(event.robotId, type, `${label} ${state}`);
    }

    const waypoint = Number(event.currentWp);
    const total = Number(event.totalWp);
    const previousWaypoint = this.agentWaypoints.get(key);
    if (Number.isFinite(waypoint)) {
      this.agentWaypoints.set(key, waypoint);
    }
    if (
      state === 'RUNNING' &&
      Number.isFinite(waypoint) &&
      Number.isFinite(total) &&
      waypoint > 0 &&
      total > 0 &&
      waypoint !== previousWaypoint
    ) {
      this.emitRobotEvent(event.robotId, 'wp', `${this.agentLabel(event.agentId)} WP ${waypoint}/${total}`);
    }
  }

  private emitRobotEvent(robotId: string, type: RobotEventPayload['type'], msg: string) {
    this.broadcastEvent({
      robotId,
      type,
      msg,
      timestamp: new Date().toISOString(),
    });
  }

  private agentLabel(agentId: string): string {
    return ({
      ugv: 'UGV',
      brouette: 'Brouette',
      drone: 'Drone',
    } as Record<string, string>)[agentId] ?? agentId;
  }

  private isTeleopBlocked(robotId: string): boolean {
    const mode = this.robotModes.get(robotId);
    const missionState = this.missionStates.get(robotId) ?? 'IDLE';
    const missionActive = missionState === 'RUNNING' || missionState === 'STANDBY';
    const estop = mode === 'ESTOP' || mode === 'EMERGENCY_STOP';
    return estop || missionActive;
  }

  private async postToBridge(
    base: string,
    path: string,
    body: object,
  ): Promise<{ ok: boolean; error?: string; bridge?: unknown }> {
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      let bridge: unknown = raw;
      try {
        bridge = raw ? JSON.parse(raw) : undefined;
      } catch {
        // Keep raw text for diagnostics.
      }
      if (!res.ok) {
        this.logger.warn(`Bridge ${path} returned ${res.status}`);
        return { ok: false, error: `bridge_${res.status}`, bridge };
      }
      return { ok: true, bridge };
    } catch (err) {
      this.logger.warn(`Bridge ${path} failed: ${String(err)}`);
      return { ok: false, error: 'bridge_failed' };
    }
  }

  private extractToken(client: Socket): string | null {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken) return authToken;
    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice('Bearer '.length);
    }
    return null;
  }

  private async canCommand(client: Socket): Promise<boolean> {
    let role = client.data.user?.role;
    if (!role) {
      const token = this.extractToken(client);
      if (token) {
        try {
          const payload = await this.jwtService.verifyAsync<{ sub: string }>(token);
          const user = await this.usersService.findById(payload.sub);
          if (user) {
            client.data.user = { id: user.id, role: user.role };
            role = user.role;
          }
        } catch {
          // Keep role empty; the command will be rejected below.
        }
      }
    }
    const allowed = role === Role.ADMIN || role === Role.OPERATOR;
    if (!allowed) {
      this.logger.warn(`Command rejected for ${client.id}: role=${role ?? 'anonymous'}`);
    }
    return allowed;
  }
}
