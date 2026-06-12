/**
 * Stand-alone TypeORM DataSource for the migration CLI.
 *
 * The app itself boots via TypeOrmModule.forRootAsync (see app.module.ts) and
 * runs with `synchronize` in dev. Migrations are provided for production
 * correctness; run them with:
 *
 *   pnpm --filter @terra-os/api migration:run
 *
 * Honours the same DATABASE_URL / DATABASE_SSL env vars as the app.
 */
import 'reflect-metadata';
import { DataSource, type DataSourceOptions } from 'typeorm';

const dbUrl = process.env.DATABASE_URL;
const isSqlite = !dbUrl || dbUrl.startsWith('sqlite');
const sqliteFile = dbUrl?.replace(/^sqlite:/, '') ?? 'terraos-dev.sqlite';
const useSsl = process.env.DATABASE_SSL === 'true';

const common = {
  entities: [__dirname + '/../**/*.entity.{ts,js}'],
  migrations: [__dirname + '/../migrations/*.{ts,js}'],
  synchronize: false,
};

const options: DataSourceOptions = isSqlite
  ? { type: 'sqlite', database: sqliteFile, ...common }
  : {
      type: 'postgres',
      url: dbUrl,
      ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
      ...common,
    };

export default new DataSource(options);
