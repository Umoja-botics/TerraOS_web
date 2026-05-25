import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RobotsModule } from './robots/robots.module';
import { MissionsModule } from './missions/missions.module';
import { PathsModule } from './paths/paths.module';
import { ReportsModule } from './reports/reports.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { PluginsModule } from './plugins/plugins.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dbUrl = config.get<string>('DATABASE_URL');
        const isSqlite = !dbUrl || dbUrl.startsWith('sqlite');
        const sqliteFile = dbUrl?.replace(/^sqlite:/, '') ?? 'terraos.sqlite';
        return {
          type: isSqlite ? 'sqlite' : 'postgres',
          ...(isSqlite ? { database: sqliteFile } : { url: dbUrl }),
          autoLoadEntities: true,
          synchronize: process.env.NODE_ENV !== 'production',
        };
      },
    }),

    AuthModule,
    UsersModule,
    RobotsModule,
    MissionsModule,
    PathsModule,
    ReportsModule,
    TelemetryModule,
    PluginsModule,
    HealthModule,
  ],
})
export class AppModule {}
