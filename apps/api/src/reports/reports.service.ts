import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReportEntity } from './report.entity';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(ReportEntity)
    private repo: Repository<ReportEntity>,
  ) {}

  findAll(): Promise<ReportEntity[]> {
    return this.repo.find();
  }

  findByMission(missionId: string): Promise<ReportEntity[]> {
    return this.repo.findBy({ missionId });
  }

  async findById(id: string): Promise<ReportEntity> {
    const report = await this.repo.findOneBy({ id });
    if (!report) throw new NotFoundException(`Report ${id} not found`);
    return report;
  }

  create(data: Partial<ReportEntity>): Promise<ReportEntity> {
    return this.repo.save(this.repo.create(data));
  }

  async delete(id: string): Promise<void> {
    const report = await this.findById(id);
    await this.repo.remove(report);
  }
}
