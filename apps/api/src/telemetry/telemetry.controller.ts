import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { TelemetryGateway } from './telemetry.gateway';
import { Public } from '../common/decorators/public.decorator';
import { MissionsService } from '../missions/missions.service';
import type {
  RobotTelemetryEvent,
  RobotStatusEvent,
  SystemHealthEvent,
  RobotEventPayload,
  MissionUpdateEvent,
  OrchestrationStatus,
  AgentStatusEvent,
} from '@terra-os/types';

@ApiTags('telemetry')
@Controller('robots/:id/telemetry')
export class TelemetryController {
  constructor(
    private gateway: TelemetryGateway,
    private missionsService: MissionsService,
  ) {}

  @Public()
  @Post('status')
  @ApiOperation({ summary: 'Bridge pushes robot status' })
  pushStatus(@Param('id') robotId: string, @Body() body: Omit<RobotStatusEvent, 'robotId'>) {
    this.gateway.broadcastStatus({ robotId, ...body });
    return { ok: true };
  }

  @Public()
  @Post()
  @ApiOperation({ summary: 'Bridge pushes telemetry data' })
  pushTelemetry(@Param('id') robotId: string, @Body() body: Omit<RobotTelemetryEvent, 'robotId'>) {
    this.gateway.broadcastTelemetry({ robotId, ...body });
    return { ok: true };
  }

  @Public()
  @Post('health')
  @ApiOperation({ summary: 'Bridge pushes system health' })
  pushHealth(@Param('id') robotId: string, @Body() body: Omit<SystemHealthEvent, 'robotId'>) {
    this.gateway.broadcastHealth({ robotId, ...body });
    return { ok: true };
  }

  @Public()
  @Post('event')
  @ApiOperation({ summary: 'Bridge pushes robot event' })
  pushEvent(@Param('id') robotId: string, @Body() body: Omit<RobotEventPayload, 'robotId'>) {
    this.gateway.broadcastEvent({ robotId, ...body });
    return { ok: true };
  }

  @Public()
  @Post('mission')
  @ApiOperation({ summary: 'Bridge pushes mission update' })
  async pushMission(@Param('id') robotId: string, @Body() body: Record<string, unknown>) {
    const mission = {
      robotId,
      missionId: String(body['missionId'] ?? body['mission_id'] ?? ''),
      state: String(body['state'] ?? 'IDLE'),
      currentWp: toNumber(body['currentWp'] ?? body['current_wp'], 0),
      totalWp: toNumber(body['totalWp'] ?? body['total_wp'], 0),
      navMode: String(body['navMode'] ?? body['nav_mode'] ?? ''),
      error: String(body['error'] ?? ''),
    } satisfies MissionUpdateEvent;

    this.gateway.broadcastMissionUpdate(mission);
    await this.missionsService.syncFromMissionStatus(robotId, mission).catch(() => undefined);
    return { ok: true };
  }
}

// ── Agent status controller ────────────────────────────────────────────────

@ApiTags('telemetry')
@Controller('robots/:robotId/agents')
export class AgentsController {
  constructor(private gateway: TelemetryGateway) {}

  @Public()
  @Post(':agentId/status')
  @ApiOperation({ summary: 'Bridge pushes agent mission status' })
  pushAgentStatus(
    @Param('robotId') robotId: string,
    @Param('agentId') agentId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const currentWp = toNumber(body['currentWp'] ?? body['current_wp'], 0);
    const totalWp = toNumber(body['totalWp'] ?? body['total_wp'], 0);
    const rawProgress = body['progress'];
    const progress = rawProgress !== undefined
      ? toNumber(rawProgress, 0)
      : totalWp > 0 ? Math.round((currentWp / totalWp) * 100) : 0;

    this.gateway.broadcastAgentStatus({
      robotId,
      agentId: agentId as AgentStatusEvent['agentId'],
      state: String(body['state'] ?? 'IDLE') as AgentStatusEvent['state'],
      currentWp,
      totalWp,
      progress,
    });
    return { ok: true };
  }
}

// ── Orchestration controller ───────────────────────────────────────────────

import { Controller as Ctrl } from '@nestjs/common';

@ApiTags('orchestration')
@Ctrl('orchestration')
export class OrchestrationController {
  constructor(private gateway: TelemetryGateway) {}

  @Public()
  @Post('status')
  @ApiOperation({ summary: 'Bridge pushes multi-agent orchestration status' })
  pushStatus(@Body() body: OrchestrationStatus) {
    this.gateway.broadcastOrchestration(body);
    return { ok: true };
  }
}

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
