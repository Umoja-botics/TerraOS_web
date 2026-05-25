import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportEntity } from './report.entity';
import { ReportsService } from './reports.service';
import { ReportsController, RobotReportsController } from './reports.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ReportEntity])],
  providers: [ReportsService],
  controllers: [ReportsController, RobotReportsController],
  exports: [ReportsService],
})
export class ReportsModule {}
