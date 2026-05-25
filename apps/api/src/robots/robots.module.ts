import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RobotEntity } from './robot.entity';
import { RobotsService } from './robots.service';
import { RobotsController } from './robots.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RobotEntity])],
  providers: [RobotsService],
  controllers: [RobotsController],
  exports: [RobotsService],
})
export class RobotsModule {}
