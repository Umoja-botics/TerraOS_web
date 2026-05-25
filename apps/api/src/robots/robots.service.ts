import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RobotEntity } from './robot.entity';
import { RobotStatus, type CreateRobotDto, type UpdateRobotDto } from '@terra-os/types';

@Injectable()
export class RobotsService {
  constructor(
    @InjectRepository(RobotEntity)
    private repo: Repository<RobotEntity>,
  ) {}

  findAll(): Promise<RobotEntity[]> {
    return this.repo.find();
  }

  async findById(id: string): Promise<RobotEntity> {
    const robot = await this.repo.findOneBy({ id });
    if (!robot) throw new NotFoundException(`Robot ${id} not found`);
    return robot;
  }

  create(dto: CreateRobotDto): Promise<RobotEntity> {
    return this.repo.save(this.repo.create(dto));
  }

  async update(id: string, dto: UpdateRobotDto): Promise<RobotEntity> {
    const robot = await this.findById(id);
    Object.assign(robot, dto);
    return this.repo.save(robot);
  }

  async updateLastSeen(id: string, status: RobotStatus): Promise<void> {
    await this.repo.update(id, { status, lastSeen: new Date() });
  }

  async remove(id: string): Promise<void> {
    const robot = await this.findById(id);
    await this.repo.remove(robot);
  }
}
