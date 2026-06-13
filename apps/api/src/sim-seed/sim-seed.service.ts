import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { RobotEntity } from '../robots/robot.entity';
import { PathEntity } from '../paths/path.entity';
import { MissionEntity } from '../missions/mission.entity';
import { UsersService } from '../users/users.service';
import { RobotStatus, MissionStatus, NavMode, Role } from '@terra-os/types';
import { buildFieldWaypoints } from './sim-arc';

// Stable IDs for the demo fleet (UGV reuses the historical sim id).
export const DEMO_IDS = {
  ugv:        '00000000-0000-0000-0000-000000000001',
  fieldPath:  '00000000-0000-0000-0000-000000000002',
  ugvMission: '00000000-0000-0000-0000-000000000003',
  cart:       '00000000-0000-0000-0000-000000000004',
  drone:      '00000000-0000-0000-0000-000000000005',
} as const;

export const DEMO_ROBOT_IDS = [DEMO_IDS.ugv, DEMO_IDS.cart, DEMO_IDS.drone];

/**
 * Seeds the demo fleet (3 simulators + 2 demo accounts) — but ONLY when
 * DEMO_MODE=true. Without it, no simulated robots or demo users exist, so
 * `pnpm dev` behaves exactly as a clean install (acceptance criterion 4).
 */
@Injectable()
export class SimSeedService implements OnApplicationBootstrap {
  private readonly log = new Logger(SimSeedService.name);

  constructor(
    @InjectRepository(RobotEntity)   private robots:   Repository<RobotEntity>,
    @InjectRepository(PathEntity)    private paths:    Repository<PathEntity>,
    @InjectRepository(MissionEntity) private missions: Repository<MissionEntity>,
    private users: UsersService,
    private config: ConfigService,
  ) {}

  get demoMode(): boolean {
    return this.config.get<string>('DEMO_MODE') === 'true';
  }

  async onApplicationBootstrap() {
    if (!this.demoMode) {
      this.log.log('DEMO_MODE off — no simulated robots or demo accounts seeded');
      return;
    }
    await this.seedAll();
  }

  /** Idempotent: create anything missing, refresh bridge URLs. */
  async seedAll() {
    await this.seedRobots();
    await this.seedPath();
    await this.ensureMissionTemplate();
    await this.seedDemoUsers();
  }

  private async seedRobots() {
    const fleet = [
      { id: DEMO_IDS.ugv,   name: 'UGV Faucon (démo)',          type: 'ugv',
        url: this.config.get<string>('SIM_UGV_URL')   ?? 'http://localhost:8200',
        description: 'Robot de travail au sol — simulé' },
      { id: DEMO_IDS.cart,  name: 'Brouette logistique (démo)', type: 'cart',
        url: this.config.get<string>('SIM_CART_URL')  ?? 'http://localhost:8201',
        description: 'Navette de transfert — simulée' },
      { id: DEMO_IDS.drone, name: 'Drone éclaireur (démo)',     type: 'drone',
        url: this.config.get<string>('SIM_DRONE_URL') ?? 'http://localhost:8202',
        description: 'Reconnaissance aérienne — simulée' },
    ];
    for (const r of fleet) {
      const existing = await this.robots.findOneBy({ id: r.id });
      if (!existing) {
        await this.robots.save({
          id: r.id, name: r.name, type: r.type, status: RobotStatus.OFFLINE,
          bridgeUrl: r.url, description: r.description, isSimulated: true,
        });
        this.log.log(`Demo robot created: ${r.name}`);
      } else if (existing.bridgeUrl !== r.url || !existing.isSimulated) {
        await this.robots.update(r.id, { bridgeUrl: r.url, isSimulated: true });
      }
    }
  }

  private async seedPath() {
    const waypoints = buildFieldWaypoints();
    const existing = await this.paths.findOneBy({ id: DEMO_IDS.fieldPath });
    if (existing) {
      // Refresh waypoints if the field geometry moved (e.g. new origin).
      if (existing.waypoints?.[0]?.lat !== waypoints[0].lat) {
        await this.paths.update(DEMO_IDS.fieldPath, { waypoints });
        this.log.log('Demo field path waypoints refreshed');
      }
      return;
    }
    await this.paths.save({
      id: DEMO_IDS.fieldPath,
      name: 'Champ démo — rangs parcelle nord',
      navMode: NavMode.FOLLOW_WAYPOINTS,
      waypoints,
      createdBy: DEMO_IDS.ugv,
      yamlContent: null,
    });
    this.log.log('Demo field path created (57 waypoints)');
  }

  /** Recreate the IDLE UGV mission template if absent (used on reset too). */
  async ensureMissionTemplate() {
    const existing = await this.missions.findOneBy({ id: DEMO_IDS.ugvMission });
    if (existing) {
      if (existing.status !== MissionStatus.IDLE) {
        await this.missions.update(DEMO_IDS.ugvMission, {
          status: MissionStatus.IDLE, startedAt: null, endedAt: null,
        });
      }
      return;
    }
    await this.missions.save({
      id: DEMO_IDS.ugvMission,
      robotId: DEMO_IDS.ugv,
      name: 'Mission agricole démo',
      pathId: DEMO_IDS.fieldPath,
      status: MissionStatus.IDLE,
      startedAt: null,
      endedAt: null,
      navMode: NavMode.FOLLOW_WAYPOINTS,
    });
    this.log.log('Demo mission template created');
  }

  private async seedDemoUsers() {
    const accounts = [
      { email: 'demo-viewer@terraos.app',   name: 'Démo Viewer',
        role: Role.VIEWER,
        password: this.config.get<string>('DEMO_VIEWER_PASSWORD')   ?? 'demo-viewer' },
      { email: 'demo-operator@terraos.app', name: 'Démo Operator',
        role: Role.OPERATOR,
        password: this.config.get<string>('DEMO_OPERATOR_PASSWORD') ?? 'demo-operator' },
      // Admin account so /demo/reset + the VPS cron work out of the box.
      // MUST be given a strong DEMO_ADMIN_PASSWORD on any public deployment.
      { email: 'demo-admin@terraos.app',    name: 'Démo Admin',
        role: Role.ADMIN,
        password: this.config.get<string>('DEMO_ADMIN_PASSWORD')    ?? 'demo-admin' },
    ];
    for (const a of accounts) {
      const existing = await this.users.findByEmail(a.email);
      if (existing) continue;
      await this.users.create({
        email: a.email, name: a.name, role: a.role, password: a.password,
      }).catch((err) => this.log.warn(`Demo user ${a.email}: ${String(err)}`));
      this.log.log(`Demo account created: ${a.email} (${a.role})`);
    }
  }
}
