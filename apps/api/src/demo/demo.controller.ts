import { Controller, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DemoService } from './demo.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Role } from '@terra-os/types';

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
}
