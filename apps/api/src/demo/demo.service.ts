import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { RobotEntity } from '../robots/robot.entity';
import { MissionEntity } from '../missions/mission.entity';
import { ReportEntity } from '../reports/report.entity';
import { SimSeedService } from '../sim-seed/sim-seed.service';

/**
 * Owns the single decision point for demo behaviour: detecting simulated
 * robots, relaying their mission control to the scenario player, and the
 * one-shot reset. Everything no-ops unless DEMO_MODE=true.
 */
@Injectable()
export class DemoService {
  private readonly log = new Logger(DemoService.name);

  constructor(
    @InjectRepository(RobotEntity)   private robots:   Repository<RobotEntity>,
    @InjectRepository(MissionEntity) private missions: Repository<MissionEntity>,
    @InjectRepository(ReportEntity)  private reports:  Repository<ReportEntity>,
    private simSeed: SimSeedService,
    private config: ConfigService,
  ) {}

  get enabled(): boolean {
    return this.config.get<string>('DEMO_MODE') === 'true';
  }

  private get playerUrl(): string {
    return (this.config.get<string>('SCENARIO_PLAYER_URL') ?? 'http://localhost:8300')
      .replace(/\/+$/, '');
  }

  /** True when this robot's mission control must go to the player, not a bridge. */
  isSimulated(robot: { isSimulated?: boolean }): boolean {
    return this.enabled && robot.isSimulated === true;
  }

  // ── Scenario relay ──────────────────────────────────────────────────────────

  relayStart(): Promise<void> {
    return this.post('/scenario/start');
  }

  relayStop(): Promise<void> {
    return this.post('/scenario/stop');
  }

  status(): Promise<unknown> {
    return this.get('/scenario/status');
  }

  inject(failureId: string): Promise<void> {
    return this.post(`/scenario/inject/${encodeURIComponent(failureId)}`);
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  async reset(): Promise<{ ok: boolean; purgedMissions: number; purgedReports: number }> {
    const simRobots = await this.robots.findBy({ isSimulated: true });
    const simIds = simRobots.map((r) => r.id);

    let purgedReports = 0;
    let purgedMissions = 0;
    if (simIds.length) {
      const missions = await this.missions.findBy({ robotId: In(simIds) });
      const missionIds = missions.map((m) => m.id);
      if (missionIds.length) {
        const res = await this.reports.delete({ missionId: In(missionIds) });
        purgedReports = res.affected ?? 0;
      }
      const res = await this.missions.delete({ robotId: In(simIds) });
      purgedMissions = res.affected ?? 0;
    }

    // Restore the IDLE mission template so the operator can relaunch.
    await this.simSeed.ensureMissionTemplate();

    // Reset the sims + player (best-effort — must not block a local reset).
    await this.post('/scenario/reset');

    this.log.log(`Demo reset — purged ${purgedMissions} missions, ${purgedReports} reports`);
    return { ok: true, purgedMissions, purgedReports };
  }

  // ── HTTP to the scenario player ──────────────────────────────────────────────

  private async post(path: string): Promise<void> {
    try {
      const res = await fetch(`${this.playerUrl}${path}`, { method: 'POST' });
      if (!res.ok) this.log.warn(`Player ${path} → ${res.status}`);
    } catch (err) {
      this.log.warn(`Player unreachable at ${this.playerUrl}${path}: ${String(err)}`);
    }
  }

  private async get(path: string): Promise<unknown> {
    try {
      const res = await fetch(`${this.playerUrl}${path}`);
      if (!res.ok) return { state: 'UNKNOWN', error: `player ${res.status}` };
      return await res.json();
    } catch {
      return { state: 'OFFLINE', error: 'player unreachable' };
    }
  }
}
