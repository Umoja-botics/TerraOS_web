import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { RobotStatus } from '@terra-os/types';

@Entity('robots')
export class RobotEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  type: string;

  @Column({ type: 'varchar', default: RobotStatus.OFFLINE })
  status: RobotStatus;

  @Column({ type: 'text', nullable: true })
  bridgeUrl: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @UpdateDateColumn({ nullable: true })
  lastSeen: Date | null;

  @Column({ type: 'simple-json', default: '{}' })
  config: Record<string, unknown>;
}
