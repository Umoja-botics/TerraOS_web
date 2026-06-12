import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MissionEntity } from './mission.entity';
import { MissionStatus, type CreateMissionDto, type AgentConfig, type MissionLoadDto } from '@terra-os/types';
import { RobotsService } from '../robots/robots.service';
import { PathsService } from '../paths/paths.service';
import { DemoService } from '../demo/demo.service';

@Injectable()
export class MissionsService {
  private readonly logger = new Logger(MissionsService.name);

  constructor(
    @InjectRepository(MissionEntity)
    private repo: Repository<MissionEntity>,
    private robotsService: RobotsService,
    private pathsService: PathsService,
    private demoService: DemoService,
  ) {}

  async findAll(): Promise<Array<MissionEntity & { agentConfigs: AgentConfig[] | null }>> {
    const missions = await this.repo.find({ order: { startedAt: 'DESC' } });
    return missions.map((mission) => this.toResponse(mission));
  }

  async findByRobot(robotId: string): Promise<Array<MissionEntity & { agentConfigs: AgentConfig[] | null }>> {
    const missions = await this.repo.findBy({ robotId });
    return missions.map((mission) => this.toResponse(mission));
  }

  async findById(id: string): Promise<MissionEntity & { agentConfigs: AgentConfig[] | null }> {
    return this.toResponse(await this.findEntityById(id));
  }

  private async findEntityById(id: string): Promise<MissionEntity> {
    const mission = await this.repo.findOneBy({ id });
    if (!mission) throw new NotFoundException(`Mission ${id} not found`);
    return mission;
  }

  async create(dto: CreateMissionDto): Promise<MissionEntity & { agentConfigs: AgentConfig[] | null }> {
    const agentConfigs = this.normalizeAgentConfigs(dto.agentConfigs ?? []);
    const entity = this.repo.create({
      robotId: dto.robotId,
      name: dto.name,
      navMode: dto.navMode ?? null,
      agentsJson: agentConfigs.length ? JSON.stringify(agentConfigs) : null,
      status: MissionStatus.IDLE,
    });
    return this.toResponse(await this.repo.save(entity));
  }

  async update(
    id: string,
    dto: { name?: string; robotId?: string; navMode?: string; agentConfigs?: Array<Partial<AgentConfig>> },
  ): Promise<MissionEntity & { agentConfigs: AgentConfig[] | null }> {
    const mission = await this.findEntityById(id);
    if (mission.status === MissionStatus.RUNNING) {
      throw new BadRequestException('Cannot edit a running mission');
    }
    if (dto.name)     mission.name    = dto.name;
    if (dto.robotId)  mission.robotId = dto.robotId;
    if (dto.navMode)  mission.navMode = dto.navMode;
    if (dto.agentConfigs) {
      const normalized = this.normalizeAgentConfigs(dto.agentConfigs);
      mission.agentsJson = normalized.length ? JSON.stringify(normalized) : null;
    }
    return this.toResponse(await this.repo.save(mission));
  }

  async delete(id: string): Promise<{ ok: boolean }> {
    await this.findEntityById(id);
    await this.repo.delete(id);
    return { ok: true };
  }

  async loadToRobot(id: string): Promise<MissionEntity & { agentConfigs: AgentConfig[] | null }> {
    const mission = await this.findEntityById(id);
    if (mission.status !== MissionStatus.IDLE) {
      throw new BadRequestException('Only IDLE mission profiles can be loaded');
    }

    const robot = await this.robotsService.findById(mission.robotId);
    const base = robot.bridgeUrl?.replace(/\/+$/, '');
    if (!base) return this.toResponse(mission);

    const agentConfigs = this.parseAgentConfigs(mission.agentsJson, mission.pathId);
    for (const ac of agentConfigs) {
      await this.sendAgentLoad(base, mission.id, mission.name, mission.navMode, ac);
    }

    return this.toResponse(mission);
  }

  async start(id: string): Promise<MissionEntity & { agentConfigs: AgentConfig[] | null }> {
    const template = await this.findEntityById(id);
    if (template.status !== MissionStatus.IDLE) {
      throw new BadRequestException('Mission must be IDLE to start');
    }

    // Clone template as a new run — original stays IDLE so it can be relaunched
    const run = this.repo.create({
      robotId:        template.robotId,
      name:           template.name,
      navMode:        template.navMode,
      agentsJson:     template.agentsJson,
      pathId:         template.pathId,
      orchestratorUrl: template.orchestratorUrl,
      status:         MissionStatus.RUNNING,
      startedAt:      new Date(),
    });
    const saved = await this.repo.save(run);

    const robot = await this.robotsService.findById(template.robotId);

    // Demo robots: drive the scripted scenario player, not a physical bridge.
    if (this.demoService.isSimulated(robot)) {
      await this.demoService.relayStart();
      return this.toResponse(saved);
    }

    const base = robot.bridgeUrl?.replace(/\/+$/, '');
    if (!base) return this.toResponse(saved);

    // Load waypoints to each agent before locking — mirrors faucon_server handleLoadMission
    const agentConfigs = this.parseAgentConfigs(template.agentsJson, template.pathId);
    for (const ac of agentConfigs) {
      await this.sendAgentLoad(base, saved.id, template.name, template.navMode, ac);
    }

    await this.sendToBridge(base, '/commands/mode', { type: 'MISSION_LOCK' });
    await this.sendToBridge(base, '/commands/mission/command', { agent_id: 'all', command: 'START' });

    return this.toResponse(saved);
  }

  async pause(id: string): Promise<MissionEntity & { agentConfigs: AgentConfig[] | null }> {
    const mission = await this.findEntityById(id);
    if (mission.status !== MissionStatus.RUNNING) {
      throw new BadRequestException('Mission must be RUNNING to pause');
    }
    mission.status = MissionStatus.PAUSED;
    const saved = await this.repo.save(mission);

    const robot = await this.robotsService.findById(mission.robotId).catch(() => null);
    const base = robot?.bridgeUrl?.replace(/\/+$/, '');
    if (base) {
      if (this.hasAgent(mission, 'ugv')) {
        await this.sendToBridge(base, '/commands/mission/command', { agent_id: 'ugv', command: 'PAUSE' });
      }
    }
    return this.toResponse(saved);
  }

  async resume(id: string): Promise<MissionEntity & { agentConfigs: AgentConfig[] | null }> {
    const mission = await this.findEntityById(id);
    if (mission.status !== MissionStatus.PAUSED) {
      throw new BadRequestException('Mission must be PAUSED to resume');
    }
    mission.status = MissionStatus.RUNNING;
    const saved = await this.repo.save(mission);

    const robot = await this.robotsService.findById(mission.robotId).catch(() => null);
    const base = robot?.bridgeUrl?.replace(/\/+$/, '');
    if (base) {
      if (this.hasAgent(mission, 'ugv')) {
        await this.sendToBridge(base, '/commands/mission/command', { agent_id: 'ugv', command: 'RESUME' });
      }
    }
    return this.toResponse(saved);
  }

  async resumeFromStandby(id: string): Promise<MissionEntity & { agentConfigs: AgentConfig[] | null }> {
    const mission = await this.findEntityById(id);
    if (![MissionStatus.RUNNING, MissionStatus.PAUSED].includes(mission.status)) {
      throw new BadRequestException('Mission must be RUNNING or PAUSED to resume from standby');
    }
    mission.status = MissionStatus.RUNNING;
    const saved = await this.repo.save(mission);

    const robot = await this.robotsService.findById(mission.robotId).catch(() => null);
    const base = robot?.bridgeUrl?.replace(/\/+$/, '');
    if (base) {
      await this.sendToBridge(base, '/commands/mode', { type: 'REQUEST_AUTO' });
      if (this.hasAgent(mission, 'ugv')) {
        await this.sendToBridge(base, '/commands/mission/command', { agent_id: 'ugv', command: 'RESUME' });
      }
    }
    return this.toResponse(saved);
  }

  async abort(id: string): Promise<MissionEntity & { agentConfigs: AgentConfig[] | null }> {
    const mission = await this.findEntityById(id);
    if (![MissionStatus.RUNNING, MissionStatus.PAUSED, MissionStatus.IDLE].includes(mission.status)) {
      throw new BadRequestException('Mission cannot be aborted in its current state');
    }
    mission.status = MissionStatus.ABORTED;
    mission.endedAt = new Date();
    const saved = await this.repo.save(mission);

    const robot = await this.robotsService.findById(mission.robotId).catch(() => null);
    if (robot && this.demoService.isSimulated(robot)) {
      await this.demoService.relayStop();
      return this.toResponse(saved);
    }
    const base = robot?.bridgeUrl?.replace(/\/+$/, '');
    if (base) {
      await this.sendToBridge(base, '/commands/mode', { type: 'MISSION_UNLOCK' });
      await this.sendToBridge(base, '/commands/mission/command', { agent_id: 'all', command: 'CANCEL' });
    }
    return this.toResponse(saved);
  }

  async cancelLoaded(id: string): Promise<MissionEntity & { agentConfigs: AgentConfig[] | null }> {
    const mission = await this.findEntityById(id);
    const robot = await this.robotsService.findById(mission.robotId).catch(() => null);
    const base = robot?.bridgeUrl?.replace(/\/+$/, '');
    if (base) {
      await this.sendToBridge(base, '/commands/mode', { type: 'MISSION_UNLOCK' });
      await this.sendToBridge(base, '/commands/mission/command', { agent_id: 'all', command: 'CANCEL' });
    }
    return this.toResponse(mission);
  }

  async complete(id: string): Promise<MissionEntity & { agentConfigs: AgentConfig[] | null }> {
    const mission = await this.findEntityById(id);
    mission.status = MissionStatus.COMPLETED;
    mission.endedAt = new Date();
    const saved = await this.repo.save(mission);
    await this.unlockMission(saved);
    return this.toResponse(saved);
  }

  async fail(id: string): Promise<MissionEntity & { agentConfigs: AgentConfig[] | null }> {
    const mission = await this.findEntityById(id);
    mission.status = MissionStatus.ERROR;
    mission.endedAt = new Date();
    const saved = await this.repo.save(mission);
    await this.unlockMission(saved);
    return this.toResponse(saved);
  }

  async syncFromMissionStatus(
    robotId: string,
    status: { missionId?: string; mission_id?: string; state?: string },
  ): Promise<void> {
    const missionId = status.missionId ?? status.mission_id;
    if (!missionId || !status.state) return;

    const mission = await this.repo.findOneBy({ id: missionId }).catch(() => null);
    if (!mission || mission.robotId !== robotId) return;

    const nextStatus = this.toMissionStatus(status.state);
    if (!nextStatus) return;

    mission.status = nextStatus;
    if (nextStatus === MissionStatus.RUNNING && !mission.startedAt) {
      mission.startedAt = new Date();
    }
    if ([MissionStatus.COMPLETED, MissionStatus.ABORTED, MissionStatus.ERROR, MissionStatus.FAILED].includes(nextStatus)) {
      mission.endedAt = new Date();
    }
    await this.repo.save(mission);
  }

  // ── Legacy planner: multi-agent via orchestrator ──────────────────

  async loadMission(dto: MissionLoadDto): Promise<MissionEntity & { agentConfigs: AgentConfig[] | null }> {
    const missionId = `mission_${Date.now()}`;
    const name = dto.name ?? missionId;
    const mission = this.repo.create({
      robotId: 'orchestrator',
      name,
      status: MissionStatus.IDLE,
      agentsJson: JSON.stringify(dto.agents),
      orchestratorUrl: dto.orchestratorUrl,
    });
    const saved = await this.repo.save(mission);
    const profile = { mission_id: missionId, name, agents: dto.agents };
    await this.sendToBridge(dto.orchestratorUrl, '/commands/orchestration/load', profile);
    return this.toResponse(saved);
  }

  async sendControl(id: string, command: string): Promise<{ ok: boolean }> {
    const mission = await this.findEntityById(id);
    const url = mission.orchestratorUrl;
    if (!url) throw new BadRequestException('No orchestrator URL — use /start, /pause, /resume, /abort');

    if (command === 'START') {
      mission.status = MissionStatus.RUNNING;
      mission.startedAt = new Date();
      await this.repo.save(mission);
    } else if (command === 'PAUSE') {
      mission.status = MissionStatus.PAUSED;
      await this.repo.save(mission);
    } else if (command === 'RESUME') {
      mission.status = MissionStatus.RUNNING;
      await this.repo.save(mission);
    } else if (command === 'CANCEL') {
      mission.status = MissionStatus.ABORTED;
      mission.endedAt = new Date();
      await this.repo.save(mission);
    }
    await this.sendToBridge(url, '/commands/orchestration/command', { command });
    // Fallback: also send directly to UGV mission manager in case the orchestration
    // coordinator is not running (common during development / partial stack).
    if (command === 'CANCEL' || command === 'PAUSE' || command === 'RESUME') {
      if (command === 'CANCEL' || command === 'PAUSE') {
        await this.sendToBridge(url, '/commands/teleop', { linear: 0, angular: 0 });
      }
      await this.sendToBridge(url, '/commands/mission/command', { agent_id: 'all', command });
      if (command === 'CANCEL' || command === 'PAUSE') {
        await this.sendToBridge(url, '/commands/mode', { type: 'MISSION_UNLOCK' });
      }
      if (command === 'RESUME') {
        await this.sendToBridge(url, '/commands/mode', { type: 'MISSION_LOCK' });
        await this.sendToBridge(url, '/commands/mode', { type: 'REQUEST_AUTO' });
      }
    }
    return { ok: true };
  }

  // ── Internal helpers ──────────────────────────────────────────────

  private toResponse(mission: MissionEntity): MissionEntity & { agentConfigs: AgentConfig[] | null } {
    return {
      ...mission,
      agentConfigs: this.parseAgentConfigs(mission.agentsJson, mission.pathId),
    };
  }

  private parseAgentConfigs(agentsJson: string | null, pathId?: string | null): AgentConfig[] {
    if (agentsJson) {
      try {
        const raw = JSON.parse(agentsJson) as Array<Partial<AgentConfig> & { id?: AgentConfig['agentId'] }>;
        return this.normalizeAgentConfigs(raw.map((agent) => ({
          agentId: (agent.agentId ?? agent.id) as AgentConfig['agentId'],
          pathId: agent.pathId,
          task: agent.task,
        })));
      } catch {
        this.logger.warn('Could not parse mission agentsJson');
      }
    }
    return pathId ? [{ agentId: 'ugv', pathId, task: 'follow_path' }] : [];
  }

  private normalizeAgentConfigs(configs: Partial<AgentConfig>[]): AgentConfig[] {
    return configs.map((config) => {
      const agentId = config.agentId;
      if (!agentId || !['ugv', 'brouette', 'drone'].includes(agentId)) {
        throw new BadRequestException(`Invalid agent id: ${String(agentId)}`);
      }

      const task = config.task ?? (
        agentId === 'drone' ? 'follow_waypoints' :
        agentId === 'brouette' ? 'follow_waypoints' :
        'follow_path'
      );
      const pathId = config.pathId?.trim();
      if (!(agentId === 'drone' && task === 'inspection') && !pathId) {
        throw new BadRequestException(`Agent ${agentId} requires a path`);
      }
      return {
        agentId,
        ...(pathId ? { pathId } : {}),
        task,
      };
    });
  }

  private toMissionStatus(state: string): MissionStatus | null {
    const normalized = state.toUpperCase();
    if (normalized === 'ERROR') return MissionStatus.ERROR;
    if (normalized === 'FAILED') return MissionStatus.FAILED;
    if (normalized in MissionStatus) return MissionStatus[normalized as keyof typeof MissionStatus];
    return null;
  }

  private async getPathWaypoints(pathId?: string): Promise<Array<{ latitude: number; longitude: number }>> {
    if (!pathId) return [];
    const path = await this.pathsService.findById(pathId).catch(() => null);
    return path?.waypoints.map((wp) => ({ latitude: wp.lat, longitude: wp.lon })) ?? [];
  }

  private hasAgent(mission: MissionEntity, agentId: AgentConfig['agentId']): boolean {
    return this.parseAgentConfigs(mission.agentsJson, mission.pathId).some((config) => config.agentId === agentId);
  }

  private async unlockMission(mission: MissionEntity): Promise<void> {
    const robot = await this.robotsService.findById(mission.robotId).catch(() => null);
    const base = robot?.bridgeUrl?.replace(/\/+$/, '');
    if (base) {
      await this.sendToBridge(base, '/commands/mode', { type: 'MISSION_UNLOCK' });
    }
  }

  // mission_core.py validates against {"FOLLOW_WAYPOINTS", "GO_TO_WAYPOINT"} (uppercased)
  private toFauconNavMode(navMode: string | null): string {
    const mapping: Record<string, string> = {
      FOLLOW_WAYPOINTS: 'FOLLOW_WAYPOINTS',
      GOTO_WAYPOINT:    'GO_TO_WAYPOINT',
    };
    return mapping[navMode ?? ''] ?? 'FOLLOW_WAYPOINTS';
  }

  private async sendAgentLoad(
    base: string,
    missionId: string,
    missionName: string,
    navMode: string | null,
    ac: AgentConfig,
  ): Promise<void> {
    let payload: Record<string, unknown>;

    if (ac.agentId === 'ugv') {
      const waypoints = await this.getPathWaypoints(ac.pathId);
      // Bridge converts this to YAML before publishing to /mission/load_path
      payload = { name: missionName, nav_mode: this.toFauconNavMode(navMode), waypoints };
    } else if (ac.agentId === 'brouette') {
      const waypoints = await this.getPathWaypoints(ac.pathId);
      payload = { mission_id: missionId, waypoints };
    } else {
      const waypoints = await this.getPathWaypoints(ac.pathId);
      payload = { mission_id: missionId, task: ac.task ?? 'follow_waypoints', waypoints };
    }

    await this.sendToBridge(base, '/commands/mission/load', {
      agent_id: ac.agentId,
      mission_id: missionId,
      payload,
    });
  }

  private async sendToBridge(bridgeUrl: string, path: string, body: object): Promise<void> {
    try {
      const base = bridgeUrl.replace(/\/+$/, '');
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) this.logger.warn(`Bridge ${path} returned ${res.status}`);
    } catch (err) {
      this.logger.warn(`Could not reach bridge at ${bridgeUrl}${path}: ${String(err)}`);
    }
  }
}
