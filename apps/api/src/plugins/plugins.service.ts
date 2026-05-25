import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PluginEntity } from './plugin.entity';

@Injectable()
export class PluginsService {
  constructor(
    @InjectRepository(PluginEntity)
    private repo: Repository<PluginEntity>,
  ) {}

  findAll(): Promise<PluginEntity[]> {
    return this.repo.find();
  }

  async findById(id: string): Promise<PluginEntity> {
    const plugin = await this.repo.findOneBy({ id });
    if (!plugin) throw new NotFoundException(`Plugin ${id} not found`);
    return plugin;
  }

  async toggle(id: string, enabled: boolean): Promise<PluginEntity> {
    const plugin = await this.findById(id);
    plugin.enabled = enabled;
    return this.repo.save(plugin);
  }
}
