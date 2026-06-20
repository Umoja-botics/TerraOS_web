import { Body, Controller, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { DemoService } from './demo.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Role } from '@terra-os/types';

class EstopDto {
  @IsBoolean() @IsOptional() active?: boolean;
}

@ApiTags('demo')
@ApiBearerAuth()
@Controller('demo')
export class DemoController {
  constructor(private demo: DemoService) {}

  private assertEnabled() {
    if (!this.demo.enabled) throw new ForbiddenException('DEMO_MODE is disabled');
  }

  @Get('status')
  @ApiOperation({ summary: 'Scenario player status (for the demo panel)' })
  status() {
    this.assertEnabled();
    return this.demo.status();
  }

  @Post('reset')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Reset the demo: purge sim missions/reports, reset sims + player' })
  reset() {
    this.assertEnabled();
    return this.demo.reset();
  }

  @Post('inject/:failureId')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Trigger a scripted failure injection' })
  async inject(@Param('failureId') failureId: string) {
    this.assertEnabled();
    await this.demo.inject(failureId);
    return { ok: true, failureId };
  }

  @Public()
  @Post('scenario/complete')
  @ApiOperation({ summary: 'Player callback: scenario finished — close missions, make reports' })
  scenarioComplete() {
    if (!this.demo.enabled) return { ok: false };
    return this.demo.onScenarioComplete();
  }

  // ── Per-agent control ───────────────────────────────────────────────────────

  @Post('agent/:agentId/pause')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Pause one agent (ugv|brouette|drone)' })
  async pauseAgent(@Param('agentId') agentId: string) {
    this.assertEnabled();
    await this.demo.relayPause(agentId);
    return { ok: true, agentId };
  }

  @Post('agent/:agentId/resume')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Resume one agent' })
  async resumeAgent(@Param('agentId') agentId: string) {
    this.assertEnabled();
    await this.demo.relayResume(agentId);
    return { ok: true, agentId };
  }

  @Post('agent/:agentId/estop')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'E-stop / release one agent' })
  async estopAgent(@Param('agentId') agentId: string, @Body() dto: EstopDto) {
    this.assertEnabled();
    await this.demo.relayEstop(dto.active ?? true, agentId);
    return { ok: true, agentId, active: dto.active ?? true };
  }

  @Post('estop')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Global E-stop / release — halts every demo robot' })
  async estopAll(@Body() dto: EstopDto) {
    this.assertEnabled();
    await this.demo.relayEstop(dto.active ?? true);
    return { ok: true, active: dto.active ?? true };
  }
}
