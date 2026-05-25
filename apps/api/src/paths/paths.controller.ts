import {
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { PathsService } from './paths.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@terra-os/types';
import type { UserEntity } from '../users/user.entity';

@ApiTags('paths')
@ApiBearerAuth()
@Controller('paths')
export class PathsController {
  constructor(private pathsService: PathsService) {}

  @Get()
  findAll() {
    return this.pathsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.pathsService.findById(id);
  }

  @Get(':id/raw')
  @Header('Content-Type', 'text/yaml')
  async getRaw(@Param('id') id: string, @Res() res: Response) {
    const content = await this.pathsService.getRawYaml(id);
    res.setHeader('Content-Disposition', `attachment; filename="path_${id}.yaml"`);
    res.send(content);
  }

  @Post()
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'Faucon YAML path file', schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file'))
  create(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: UserEntity,
  ) {
    if (!file) throw new BadRequestException('No YAML file uploaded');
    return this.pathsService.createFromYaml(file.buffer.toString('utf-8'), user.id);
  }

  @Put(':id')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: 'Updated Faucon YAML path file', schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file'))
  update(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No YAML file uploaded');
    return this.pathsService.update(id, file.buffer.toString('utf-8'));
  }

  @Delete(':id')
  @Roles(Role.OPERATOR, Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.pathsService.remove(id);
  }
}
