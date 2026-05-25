import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery, ApiOperation } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@terra-os/types';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Get()
  @ApiQuery({ name: 'missionId', required: false })
  findAll(@Query('missionId') missionId?: string) {
    if (missionId) return this.reportsService.findByMission(missionId);
    return this.reportsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.reportsService.findById(id);
  }

  @Delete(':id')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.reportsService.delete(id);
  }
}

// Separate controller for bridge ingest — no JWT required
@ApiTags('telemetry')
@Controller('robots/:robotId/reports')
export class RobotReportsController {
  constructor(private reportsService: ReportsService) {}

  @Public()
  @Post()
  @ApiOperation({ summary: 'Bridge posts mission report when mission ends' })
  ingestReport(@Param('robotId') _robotId: string, @Body() body: Record<string, unknown>) {
    return this.reportsService.create({
      reportId: body['report_id'] as string,
      missionId: body['mission_id'] as string,
      name: body['name'] as string,
      navMode: body['nav_mode'] as string,
      startedAt: body['started_at'] ? new Date(body['started_at'] as string) : null,
      endedAt: body['ended_at'] ? new Date(body['ended_at'] as string) : null,
      durationS: (body['duration_s'] as number) ?? 0,
      status: body['status'] as string,
      totalWp: (body['total_wp'] as number) ?? 0,
      completedWp: (body['completed_wp'] as number) ?? 0,
      distanceM: (body['distance_m'] as number) ?? 0,
      gpsTrace: (body['gps_trace'] as []) ?? [],
      events: (body['events'] as []) ?? [],
      faultHistory: (body['fault_history'] as []) ?? [],
    });
  }
}
