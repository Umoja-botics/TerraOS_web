import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { MissionStatus } from '@terra-os/types';

@Entity('missions')
export class MissionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  robotId: string;

  @Column()
  name: string;

  @Column({ nullable: true, type: 'text' })
  pathId: string | null;

  @Column({ type: 'varchar', default: MissionStatus.IDLE })
  status: MissionStatus;

  @Column({ nullable: true, type: 'datetime' })
  startedAt: Date | null;

  @Column({ nullable: true, type: 'datetime' })
  endedAt: Date | null;

  @Column({ nullable: true, type: 'varchar' })
  navMode: string | null;

  // Agent configs: JSON array of {agentId, pathId}
  @Column({ nullable: true, type: 'text' })
  agentsJson: string | null;

  @Column({ nullable: true, type: 'text' })
  orchestratorUrl: string | null;
}
