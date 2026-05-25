import { Module } from '@nestjs/common';
import { TelemetryGateway } from './telemetry.gateway';
import { TelemetryController, AgentsController, OrchestrationController } from './telemetry.controller';
import { RobotsModule } from '../robots/robots.module';
import { MissionsModule } from '../missions/missions.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [RobotsModule, MissionsModule, AuthModule, UsersModule],
  providers: [TelemetryGateway],
  controllers: [TelemetryController, AgentsController, OrchestrationController],
  exports: [TelemetryGateway],
})
export class TelemetryModule {}
