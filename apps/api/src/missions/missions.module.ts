import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MissionEntity } from './mission.entity';
import { MissionsService } from './missions.service';
import { MissionsController } from './missions.controller';
import { RobotsModule } from '../robots/robots.module';
import { PathsModule } from '../paths/paths.module';

@Module({
  imports: [TypeOrmModule.forFeature([MissionEntity]), RobotsModule, PathsModule],
  providers: [MissionsService],
  controllers: [MissionsController],
  exports: [MissionsService],
})
export class MissionsModule {}
