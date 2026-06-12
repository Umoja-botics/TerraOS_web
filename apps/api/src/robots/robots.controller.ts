import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { RobotsService } from './robots.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@terra-os/types';

class CreateRobotDto {
  @IsString() name: string;
  @IsString() type: string;
  @IsString() @IsOptional() bridgeUrl?: string;
  @IsString() @IsOptional() description?: string;
  @IsBoolean() @IsOptional() isSimulated?: boolean;
}

class UpdateRobotDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() type?: string;
  @IsString() @IsOptional() bridgeUrl?: string;
  @IsString() @IsOptional() description?: string;
  @IsBoolean() @IsOptional() isSimulated?: boolean;
}

@ApiTags('robots')
@ApiBearerAuth()
@Controller('robots')
export class RobotsController {
  constructor(private robotsService: RobotsService) {}

  @Get()
  findAll() {
    return this.robotsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.robotsService.findById(id);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() dto: CreateRobotDto) {
    return this.robotsService.create(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateRobotDto) {
    return this.robotsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.robotsService.remove(id);
  }
}
