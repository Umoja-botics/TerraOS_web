import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { RobotEntity } from '../robots/robot.entity';
import { PathEntity } from '../paths/path.entity';
import { MissionEntity } from '../missions/mission.entity';
import { RobotStatus, MissionStatus, NavMode } from '@terra-os/types';
import { buildFieldWaypoints } from './sim-arc';

const SIM_ROBOT_ID   = '00000000-0000-0000-0000-000000000001';
const SIM_PATH_ID    = '00000000-0000-0000-0000-000000000002';
const SIM_MISSION_ID = '00000000-0000-0000-0000-000000000003';

@Injectable()
export class SimSeedService implements OnApplicationBootstrap {
  private readonly log = new Logger(SimSeedService.name);

  constructor(
    @InjectRepository(RobotEntity)  private robots:   Repository<RobotEntity>,
    @InjectRepository(PathEntity)   private paths:    Repository<PathEntity>,
    @InjectRepository(MissionEntity) private missions: Repository<MissionEntity>,
    private config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    await this.seedRobot();
    await this.seedPath();
    await this.seedMission();
  }

  private async seedRobot() {
    const bridgeUrl = this.config.get<string>('SIM_BRIDGE_URL') ?? null;
    const existing  = await this.robots.findOneBy({ id: SIM_ROBOT_ID });
    if (!existing) {
      await this.robots.save({
        id: SIM_ROBOT_ID,
        name: 'TerraOS Simulation',
        type: 'ugv',
        status: RobotStatus.OFFLINE,
        bridgeUrl,
        description: 'Robot simulé — aucun matériel physique requis',
      });
      this.log.log('Sim robot created');
    } else if (bridgeUrl && existing.bridgeUrl !== bridgeUrl) {
      await this.robots.update(SIM_ROBOT_ID, { bridgeUrl });
      this.log.log('Sim robot bridgeUrl updated');
    }
  }

  private async seedPath() {
    const existing = await this.paths.findOneBy({ id: SIM_PATH_ID });
    if (existing) return;
    await this.paths.save({
      id: SIM_PATH_ID,
      name: 'Champ démo',
      navMode: NavMode.FOLLOW_WAYPOINTS,
      waypoints: buildFieldWaypoints(),
      createdBy: SIM_ROBOT_ID,
      yamlContent: null,
    });
    this.log.log('Sim path created (57 waypoints)');
  }

  private async seedMission() {
    const existing = await this.missions.findOneBy({ id: SIM_MISSION_ID });
    if (existing) return;
    await this.missions.save({
      id: SIM_MISSION_ID,
      robotId: SIM_ROBOT_ID,
      name: 'Mission démo',
      pathId: SIM_PATH_ID,
      status: MissionStatus.IDLE,
      startedAt: null,
      endedAt: null,
      navMode: NavMode.FOLLOW_WAYPOINTS,
    });
    this.log.log('Sim mission created');
  }
}
