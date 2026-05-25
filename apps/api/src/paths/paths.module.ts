import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PathEntity } from './path.entity';
import { PathsService } from './paths.service';
import { PathsController } from './paths.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PathEntity])],
  providers: [PathsService],
  controllers: [PathsController],
  exports: [PathsService],
})
export class PathsModule {}
