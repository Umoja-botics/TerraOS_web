import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RobotEntity } from '../robots/robot.entity';
import { PathEntity } from '../paths/path.entity';
import { MissionEntity } from '../missions/mission.entity';
import { UsersModule } from '../users/users.module';
import { SimSeedService } from './sim-seed.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RobotEntity, PathEntity, MissionEntity]),
    UsersModule,
  ],
  providers: [SimSeedService],
  exports: [SimSeedService],
})
export class SimSeedModule {}
