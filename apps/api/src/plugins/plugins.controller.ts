import { Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PluginsService } from './plugins.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@terra-os/types';

@ApiTags('plugins')
@ApiBearerAuth()
@Controller('plugins')
export class PluginsController {
  constructor(private pluginsService: PluginsService) {}

  @Get()
  @Roles(Role.ADMIN)
  findAll() {
    return this.pluginsService.findAll();
  }

  @Patch(':id/enable')
  @Roles(Role.ADMIN)
  enable(@Param('id') id: string) {
    return this.pluginsService.toggle(id, true);
  }

  @Patch(':id/disable')
  @Roles(Role.ADMIN)
  disable(@Param('id') id: string) {
    return this.pluginsService.toggle(id, false);
  }
}
