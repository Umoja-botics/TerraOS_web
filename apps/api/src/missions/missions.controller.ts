import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { MissionsService } from './missions.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@terra-os/types';

class AgentConfigDto {
  @IsString() agentId: string;
  @IsString() @IsOptional() pathId?: string;
  @IsString() @IsOptional() task?: string;
}

class CreateMissionDto {
  // Robot reference — not strictly @IsUUID so demo robots (fixed all-zero ids,
  // not spec-valid v4 UUIDs) can be targeted. Existence is checked at start.
  @IsString() robotId: string;
  @IsString() name: string;
  @IsString() navMode: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => AgentConfigDto)
  agentConfigs: AgentConfigDto[];
}

class UpdateMissionDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() robotId?: string;
  @IsString() @IsOptional() navMode?: string;
  @IsArray() @IsOptional() @ValidateNested({ each: true }) @Type(() => AgentConfigDto)
  agentConfigs?: AgentConfigDto[];
}

class MissionControlDto {
  @IsString() command: string;
}

class MissionLoadBodyDto {
  @IsString() @IsOptional() name?: string;
  @IsString() orchestratorUrl: string;
  @IsArray() agents: unknown[];
}

@ApiTags('missions')
@ApiBearerAuth()
@Controller('missions')
export class MissionsController {
  constructor(private missionsService: MissionsService) {}

  @Get()
  findAll(@Query('robotId') robotId?: string) {
    if (robotId) return this.missionsService.findByRobot(robotId);
    return this.missionsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.missionsService.findById(id);
  }

  @Post()
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Create a mission profile (IDLE state)' })
  create(@Body() dto: CreateMissionDto) {
    return this.missionsService.create(dto as any);
  }

  @Patch(':id')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Update a non-running mission' })
  update(@Param('id') id: string, @Body() dto: UpdateMissionDto) {
    return this.missionsService.update(id, dto as any);
  }

  @Delete(':id')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Delete a mission profile' })
  delete(@Param('id') id: string) {
    return this.missionsService.delete(id);
  }

  @Post(':id/start')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Start mission → RUNNING, dispatch all agents' })
  start(@Param('id') id: string) {
    return this.missionsService.start(id);
  }

  @Post(':id/load')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Load mission profile to the robot and keep UI READY' })
  loadProfile(@Param('id') id: string) {
    return this.missionsService.loadToRobot(id);
  }

  @Post(':id/pause')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Pause a running mission' })
  pause(@Param('id') id: string) {
    return this.missionsService.pause(id);
  }

  @Post(':id/resume')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Resume a paused mission' })
  resume(@Param('id') id: string) {
    return this.missionsService.resume(id);
  }

  @Post(':id/resume-standby')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Resume from system-triggered STANDBY' })
  resumeFromStandby(@Param('id') id: string) {
    return this.missionsService.resumeFromStandby(id);
  }

  @Post(':id/abort')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Abort a mission' })
  abort(@Param('id') id: string) {
    return this.missionsService.abort(id);
  }

  @Post(':id/cancel-loaded')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Cancel a loaded READY mission without changing the profile' })
  cancelLoaded(@Param('id') id: string) {
    return this.missionsService.cancelLoaded(id);
  }

  @Post(':id/complete')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Mark a mission as completed' })
  complete(@Param('id') id: string) {
    return this.missionsService.complete(id);
  }

  @Post(':id/error')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Mark a mission as failed due to robot or agent error' })
  error(@Param('id') id: string) {
    return this.missionsService.fail(id);
  }

  @Post(':id/stop')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Alias for abort (legacy)' })
  stop(@Param('id') id: string) {
    return this.missionsService.abort(id);
  }

  @Post('load')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Legacy orchestrator load' })
  load(@Body() dto: MissionLoadBodyDto) {
    return this.missionsService.loadMission(dto as any);
  }

  @Post(':id/agents/:agentId/pause')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Pause a single agent without pausing the whole mission' })
  pauseAgent(@Param('id') id: string, @Param('agentId') agentId: string) {
    return this.missionsService.pauseAgent(id, agentId);
  }

  @Post(':id/agents/:agentId/resume')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Resume a single paused agent' })
  resumeAgent(@Param('id') id: string, @Param('agentId') agentId: string) {
    return this.missionsService.resumeAgent(id, agentId);
  }

  @Post(':id/agents/:agentId/cancel')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Cancel a single agent individually (mission keeps running)' })
  cancelAgent(@Param('id') id: string, @Param('agentId') agentId: string) {
    return this.missionsService.cancelAgent(id, agentId);
  }

  @Post(':id/control')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Legacy orchestration command' })
  control(@Param('id') id: string, @Body() dto: MissionControlDto) {
    return this.missionsService.sendControl(id, dto.command);
  }
}
