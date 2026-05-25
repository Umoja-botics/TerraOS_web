import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as yaml from 'js-yaml';
import { PathEntity } from './path.entity';
import { NavMode } from '@terra-os/types';

interface RawWaypoint {
  latitude?: number;
  longitude?: number;
  lat?: number;
  lon?: number;
  lng?: number;
  yaw?: number;
}

interface FauconYaml {
  name: string;
  nav_mode?: string;
  waypoints: RawWaypoint[];
}

function parseWaypoint(wp: RawWaypoint) {
  const lat = wp.latitude ?? wp.lat;
  const lon = wp.longitude ?? wp.lon ?? wp.lng;
  if (lat === undefined || lon === undefined) {
    throw new BadRequestException('Waypoint missing lat/lon coordinates');
  }
  return { lat, lon, yaw: wp.yaw ?? 0 };
}

@Injectable()
export class PathsService {
  constructor(
    @InjectRepository(PathEntity)
    private repo: Repository<PathEntity>,
  ) {}

  findAll(): Promise<PathEntity[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async findById(id: string): Promise<PathEntity> {
    const path = await this.repo.findOneBy({ id });
    if (!path) throw new NotFoundException(`Path ${id} not found`);
    return path;
  }

  async getRawYaml(id: string): Promise<string> {
    const path = await this.findById(id);
    if (path.yamlContent) return path.yamlContent;
    // Regenerate canonical YAML from stored waypoints
    const wps = path.waypoints
      .map((wp) => `  - latitude: ${wp.lat}\n    longitude: ${wp.lon}\n    yaw: ${wp.yaw ?? 0}`)
      .join('\n');
    return `name: "${path.name}"\nnav_mode: "${path.navMode}"\nwaypoints:\n${wps}\n`;
  }

  async createFromYaml(yamlContent: string, userId: string): Promise<PathEntity> {
    let doc: FauconYaml;
    try {
      doc = yaml.load(yamlContent) as FauconYaml;
    } catch {
      throw new BadRequestException('Invalid YAML content');
    }
    if (!doc?.name) throw new BadRequestException('YAML must contain a "name" field');
    if (!Array.isArray(doc.waypoints) || doc.waypoints.length === 0)
      throw new BadRequestException('YAML must contain a non-empty "waypoints" array');

    const navMode = (doc.nav_mode as NavMode) ?? NavMode.FOLLOW_WAYPOINTS;
    const waypoints = doc.waypoints.map(parseWaypoint);

    return this.repo.save(
      this.repo.create({ name: doc.name, navMode, waypoints, yamlContent, createdBy: userId }),
    );
  }

  async update(id: string, yamlContent: string): Promise<PathEntity> {
    const existing = await this.findById(id);
    let doc: FauconYaml;
    try {
      doc = yaml.load(yamlContent) as FauconYaml;
    } catch {
      throw new BadRequestException('Invalid YAML content');
    }
    if (!doc?.name) throw new BadRequestException('YAML must contain a "name" field');
    if (!Array.isArray(doc.waypoints) || doc.waypoints.length === 0)
      throw new BadRequestException('YAML must contain a non-empty "waypoints" array');

    const navMode = (doc.nav_mode as NavMode) ?? NavMode.FOLLOW_WAYPOINTS;
    const waypoints = doc.waypoints.map(parseWaypoint);

    existing.name = doc.name;
    existing.navMode = navMode;
    existing.waypoints = waypoints;
    existing.yamlContent = yamlContent;
    return this.repo.save(existing);
  }

  async remove(id: string): Promise<void> {
    const path = await this.findById(id);
    await this.repo.remove(path);
  }
}
