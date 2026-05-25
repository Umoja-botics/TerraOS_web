import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { NavMode } from '@terra-os/types';
import type { Waypoint } from '@terra-os/types';

@Entity('paths')
export class PathEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', default: NavMode.FOLLOW_WAYPOINTS })
  navMode: NavMode;

  @Column({ type: 'simple-json', default: '[]' })
  waypoints: Waypoint[];

  @Column({ type: 'text', nullable: true })
  yamlContent: string | null;

  @Column()
  createdBy: string;

  @CreateDateColumn()
  createdAt: Date;
}
