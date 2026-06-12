import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RobotEntity } from '../robots/robot.entity';
import { MissionEntity } from '../missions/mission.entity';
import { ReportEntity } from '../reports/report.entity';
import { SimSeedModule } from '../sim-seed/sim-seed.module';
import { DemoService } from './demo.service';
import { DemoController } from './demo.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([RobotEntity, MissionEntity, ReportEntity]),
    SimSeedModule,
  ],
  providers: [DemoService],
  controllers: [DemoController],
  exports: [DemoService],
})
export class DemoModule {}
