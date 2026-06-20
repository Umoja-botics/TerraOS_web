import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RobotsModule } from './robots/robots.module';
import { MissionsModule } from './missions/missions.module';
import { PathsModule } from './paths/paths.module';
import { ReportsModule } from './reports/reports.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { PluginsModule } from './plugins/plugins.module';
import { HealthModule } from './health/health.module';
import { SimSeedModule } from './sim-seed/sim-seed.module';
import { DemoModule } from './demo/demo.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): TypeOrmModuleOptions => {
        const dbUrl = config.get<string>('DATABASE_URL');
        const isSqlite = !dbUrl || dbUrl.startsWith('sqlite');
        const sqliteFile = dbUrl?.replace(/^sqlite:/, '') ?? 'terraos.sqlite';
        const synchronize = config.get<string>('TYPEORM_SYNCHRONIZE');
        const useSsl = config.get<string>('DATABASE_SSL') === 'true';
        const shouldSynchronize = synchronize ? synchronize === 'true' : process.env.NODE_ENV !== 'production';

        if (isSqlite) {
          return {
            type: 'sqlite',
            database: sqliteFile,
            autoLoadEntities: true,
            synchronize: shouldSynchronize,
          };
        }

        return {
          type: 'postgres',
          url: dbUrl,
          ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
          autoLoadEntities: true,
          synchronize: shouldSynchronize,
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
    SimSeedModule,
    DemoModule,
  ],
})
export class AppModule {}
