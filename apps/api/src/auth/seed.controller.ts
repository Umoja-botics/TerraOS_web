import { Body, Controller, ForbiddenException, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { UsersService } from '../users/users.service';
import { Public } from '../common/decorators/public.decorator';
import { Role } from '@terra-os/types';

class SeedAdminDto {
  @IsEmail() email: string;
  @IsString() name: string;
  @IsString() @MinLength(8) password: string;
}

@ApiTags('seed')
@Controller('seed')
export class SeedController {
  constructor(private usersService: UsersService) {}

  @Public()
  @Post('admin')
  @ApiOperation({ summary: 'Create first admin (dev only — remove in production)' })
  async seedAdmin(@Body() dto: SeedAdminDto) {
    const allowed = process.env.ALLOW_SEED_ADMIN === 'true' || process.env.NODE_ENV !== 'production';
    if (!allowed) {
      throw new ForbiddenException('Admin seed is disabled');
    }
    const adminCount = await this.usersService.countAdmins();
    if (adminCount > 0) return { message: 'Admin already exists' };
    return this.usersService.create({ ...dto, role: Role.ADMIN });
  }
}
