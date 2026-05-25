import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { GpsTracePoint, MissionEvent, Fault } from '@terra-os/types';

@Entity('mission_reports')
export class ReportEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  reportId: string;

  @Column()
  missionId: string;

  @Column({ nullable: true })
  name: string;

  @Column({ nullable: true })
  navMode: string;

  @Column({ nullable: true, type: Date })
  startedAt: Date | null;

  @Column({ nullable: true, type: Date })
  endedAt: Date | null;

  @Column({ type: 'float', default: 0 })
  durationS: number;

  @Column({ nullable: true })
  status: string;

  @Column({ type: 'int', default: 0 })
  totalWp: number;

  @Column({ type: 'int', default: 0 })
  completedWp: number;

  @Column({ type: 'float', default: 0 })
  distanceM: number;

  @Column({ type: 'simple-json', default: '[]' })
  agents: string[];

  @Column({ nullable: true, type: 'text' })
  pathName: string | null;

  @Column({ type: 'simple-json', default: '[]' })
  gpsTrace: GpsTracePoint[];

  @Column({ type: 'simple-json', default: '[]' })
  events: MissionEvent[];

  @Column({ type: 'simple-json', default: '[]' })
  faultHistory: Fault[];
}
