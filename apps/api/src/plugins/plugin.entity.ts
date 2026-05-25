import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { PluginManifest } from '@terra-os/types';

@Entity('plugins')
export class PluginEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'simple-json' })
  manifest: PluginManifest;

  @Column({ default: false })
  enabled: boolean;

  @Column({ type: 'simple-json', default: '{}' })
  config: Record<string, unknown>;
}
